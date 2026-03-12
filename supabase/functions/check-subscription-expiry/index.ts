import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date();

    // 1. Deactivate expired subscriptions
    const { data: activeSubscriptions } = await supabase
      .from("user_subscriptions")
      .select("id, user_id, expires_at, status")
      .eq("status", "active")
      .not("expires_at", "is", null);

    let deactivated = 0;
    if (activeSubscriptions) {
      for (const sub of activeSubscriptions) {
        if (sub.expires_at && new Date(sub.expires_at) <= now) {
          await supabase
            .from("user_subscriptions")
            .update({ status: "expired" })
            .eq("id", sub.id);
          deactivated++;
        }
      }
    }

    // 2. Send expiry warnings (24h before expiry)
    const warningThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const { data: expiringSoon } = await supabase
      .from("user_subscriptions")
      .select("id, user_id, expires_at, expiry_notified_at")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .is("expiry_notified_at", null);

    let notified = 0;
    if (expiringSoon) {
      for (const sub of expiringSoon) {
        if (sub.expires_at && new Date(sub.expires_at) <= warningThreshold) {
          // Mark as notified
          await supabase
            .from("user_subscriptions")
            .update({ expiry_notified_at: now.toISOString() })
            .eq("id", sub.id);

          // Create a peer notification for the user
          await supabase.from("peer_notifications").insert({
            peer_name: "Subscription",
            event_type: "subscription_expiring",
            peer_id: null,
          });

          notified++;
        }
      }
    }

    return new Response(
      JSON.stringify({ deactivated, notified, checked_at: now.toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

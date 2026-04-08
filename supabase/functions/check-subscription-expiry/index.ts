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

    // 1. Handle expired subscriptions (auto-renew or deactivate)
    const { data: activeSubscriptions } = await supabase
      .from("user_subscriptions")
      .select("id, user_id, expires_at, status, auto_renew, plan_id, peer_count, total_amount")
      .eq("status", "active")
      .not("expires_at", "is", null);

    let deactivated = 0;
    let renewed = 0;

    if (activeSubscriptions) {
      for (const sub of activeSubscriptions) {
        if (sub.expires_at && new Date(sub.expires_at) <= now) {
          if (sub.auto_renew && sub.plan_id) {
            // Get plan duration
            const { data: plan } = await supabase
              .from("subscription_plans")
              .select("duration_hours, is_active")
              .eq("id", sub.plan_id)
              .maybeSingle();

            if (plan?.is_active) {
              const durationMs = (plan.duration_hours || 720) * 3600000;
              const newExpiry = new Date(now.getTime() + durationMs).toISOString();

              // Renew: reset expiry, clear notification flag
              await supabase
                .from("user_subscriptions")
                .update({
                  expires_at: newExpiry,
                  expiry_notified_at: null,
                })
                .eq("id", sub.id);

              // Create a pending payment for the renewal
              const { data: walletRes } = await supabase
                .from("server_settings")
                .select("setting_value")
                .eq("setting_key", "gyd_wallet_address")
                .maybeSingle();

              if (walletRes?.setting_value) {
                await supabase.from("crypto_payments").insert({
                  user_id: sub.user_id,
                  subscription_id: sub.id,
                  amount: sub.total_amount,
                  currency: "GYD",
                  wallet_address: walletRes.setting_value,
                  status: "pending",
                });
              }

              await supabase.from("peer_notifications").insert({
                peer_name: "Subscription",
                event_type: "subscription_auto_renewed",
                peer_id: null,
              });

              renewed++;
              continue;
            }
          }

          // No auto-renew or plan inactive — expire
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
          await supabase
            .from("user_subscriptions")
            .update({ expiry_notified_at: now.toISOString() })
            .eq("id", sub.id);

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
      JSON.stringify({ deactivated, renewed, notified, checked_at: now.toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

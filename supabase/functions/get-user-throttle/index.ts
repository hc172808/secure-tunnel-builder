import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's active subscription with plan details
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("*, subscription_plans(*)")
      .eq("user_id", user_id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub || !sub.subscription_plans) {
      // Free trial - default 1 Mbps
      const { data: freeSetting } = await supabase
        .from("server_settings")
        .select("setting_value")
        .eq("setting_key", "free_trial_speed_mbps")
        .maybeSingle();

      const freeSpeed = freeSetting?.setting_value ? parseInt(freeSetting.setting_value) : 1;

      return new Response(
        JSON.stringify({
          tier: "free_trial",
          speed_limit_mbps: freeSpeed,
          speed_limit_kbps: freeSpeed * 1024,
          expires_at: null,
          peer_count: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if expired
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
      await supabase
        .from("user_subscriptions")
        .update({ status: "expired" })
        .eq("id", sub.id);

      return new Response(
        JSON.stringify({
          tier: "expired",
          speed_limit_mbps: 0,
          speed_limit_kbps: 0,
          expires_at: sub.expires_at,
          peer_count: sub.peer_count,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const plan = sub.subscription_plans as any;
    const speedLimit = plan.speed_limit_mbps ?? null;

    return new Response(
      JSON.stringify({
        tier: plan.name,
        speed_limit_mbps: speedLimit,
        speed_limit_kbps: speedLimit ? speedLimit * 1024 : null,
        expires_at: sub.expires_at,
        peer_count: sub.peer_count,
        plan_name: plan.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("get-user-throttle error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

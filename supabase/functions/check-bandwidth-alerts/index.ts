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

    // Fetch all enabled alerts with peer info
    const { data: alerts, error: alertsError } = await supabase
      .from("bandwidth_alerts")
      .select("*, wireguard_peers(id, name, transfer_rx, transfer_tx)")
      .eq("enabled", true);

    if (alertsError) throw new Error(`Failed to fetch alerts: ${alertsError.message}`);
    if (!alerts || alerts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active alerts configured", triggered: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    let triggered = 0;

    for (const alert of alerts) {
      const peer = alert.wireguard_peers;
      if (!peer) continue;

      // Calculate traffic in the alert's time window from traffic_stats
      const since = new Date(now.getTime() - alert.period_hours * 3600_000).toISOString();

      const { data: stats } = await supabase
        .from("traffic_stats")
        .select("rx_bytes, tx_bytes")
        .eq("peer_id", alert.peer_id)
        .gte("recorded_at", since);

      const totalBytes = (stats || []).reduce(
        (sum, s) => sum + (s.rx_bytes || 0) + (s.tx_bytes || 0),
        0
      );

      if (totalBytes >= alert.threshold_bytes) {
        // Check cooldown: don't re-trigger within the same period
        if (alert.last_triggered_at) {
          const lastTriggered = new Date(alert.last_triggered_at).getTime();
          if (now.getTime() - lastTriggered < alert.period_hours * 3600_000) {
            continue; // Still in cooldown
          }
        }

        // Log the alert
        await supabase.from("bandwidth_alert_logs").insert({
          alert_id: alert.id,
          peer_id: alert.peer_id,
          peer_name: peer.name,
          threshold_bytes: alert.threshold_bytes,
          actual_bytes: totalBytes,
          period_hours: alert.period_hours,
        });

        // Create a peer notification
        await supabase.from("peer_notifications").insert({
          peer_id: alert.peer_id,
          peer_name: peer.name,
          event_type: "bandwidth_exceeded",
        });

        // Update last_triggered_at
        await supabase
          .from("bandwidth_alerts")
          .update({ last_triggered_at: now.toISOString() })
          .eq("id", alert.id);

        triggered++;
      }
    }

    return new Response(
      JSON.stringify({
        message: `Checked ${alerts.length} alerts, ${triggered} triggered`,
        checked: alerts.length,
        triggered,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("check-bandwidth-alerts error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

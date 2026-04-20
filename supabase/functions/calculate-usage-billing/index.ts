import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Default billing period: previous calendar month
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const now = new Date();
    const periodStart = body.period_start
      ? new Date(body.period_start)
      : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodEnd = body.period_end
      ? new Date(body.period_end)
      : new Date(now.getFullYear(), now.getMonth(), 1);

    // Load active rate tiers ordered by min_gb
    const { data: tiers } = await supabase
      .from("bandwidth_rate_tiers")
      .select("*")
      .eq("is_active", true)
      .order("min_gb", { ascending: true });

    if (!tiers || tiers.length === 0) {
      return new Response(JSON.stringify({ error: "No active rate tiers configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const calcAmount = (gb: number) => {
      let remaining = gb;
      let total = 0;
      for (const t of tiers) {
        const min = Number(t.min_gb);
        const max = t.max_gb !== null ? Number(t.max_gb) : Infinity;
        if (gb <= min) break;
        const tierSpan = Math.min(gb, max) - min;
        if (tierSpan > 0) total += tierSpan * Number(t.rate_per_gb);
        if (gb <= max) break;
      }
      return total;
    };

    // Get all peer assignments (peer -> user mapping)
    const { data: assignments } = await supabase
      .from("peer_assignments")
      .select("peer_id, user_id");

    if (!assignments || assignments.length === 0) {
      return new Response(JSON.stringify({ message: "No peer assignments", records_created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aggregate traffic per peer in period via two snapshots (first & last)
    const peerIds = [...new Set(assignments.map(a => a.peer_id))];
    let recordsCreated = 0;

    // Group by user
    const userPeers: Record<string, string[]> = {};
    for (const a of assignments) {
      if (!userPeers[a.user_id]) userPeers[a.user_id] = [];
      userPeers[a.user_id].push(a.peer_id);
    }

    for (const [userId, peers] of Object.entries(userPeers)) {
      let totalBytes = 0;
      for (const peerId of peers) {
        // Sum of (max - min) of rx+tx in period
        const { data: stats } = await supabase
          .from("traffic_stats")
          .select("rx_bytes, tx_bytes, recorded_at")
          .eq("peer_id", peerId)
          .gte("recorded_at", periodStart.toISOString())
          .lt("recorded_at", periodEnd.toISOString())
          .order("recorded_at", { ascending: true });
        if (!stats || stats.length < 2) continue;
        const first = stats[0];
        const last = stats[stats.length - 1];
        const delta = (Number(last.rx_bytes) + Number(last.tx_bytes)) -
                      (Number(first.rx_bytes) + Number(first.tx_bytes));
        if (delta > 0) totalBytes += delta;
      }

      if (totalBytes <= 0) continue;
      const totalGb = totalBytes / (1024 ** 3);
      const amountDue = calcAmount(totalGb);

      // Skip if record already exists
      const { data: existing } = await supabase
        .from("usage_billing_records")
        .select("id")
        .eq("user_id", userId)
        .eq("billing_period_start", periodStart.toISOString())
        .eq("billing_period_end", periodEnd.toISOString())
        .maybeSingle();
      if (existing) continue;

      await supabase.from("usage_billing_records").insert({
        user_id: userId,
        billing_period_start: periodStart.toISOString(),
        billing_period_end: periodEnd.toISOString(),
        total_bytes: totalBytes,
        total_gb: Number(totalGb.toFixed(4)),
        amount_due: Number(amountDue.toFixed(2)),
        currency: "GYD",
        status: "pending",
      });
      recordsCreated++;
    }

    return new Response(JSON.stringify({
      success: true,
      records_created: recordsCreated,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

    const { data: nodes } = await supabase
      .from("gyd_validator_nodes")
      .select("*")
      .eq("is_active", true);

    if (!nodes || nodes.length === 0) {
      return new Response(JSON.stringify({ checked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(nodes.map(async (n: any) => {
      const previousStatus = n.health_status;
      let status = "unhealthy";
      let block: number | null = null;
      let errorMsg: string | null = null;
      const startedAt = Date.now();
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (n.api_key) headers["Authorization"] = `Bearer ${n.api_key}`;
        const res = await fetch(n.endpoint_url, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.result) { block = parseInt(data.result, 16); status = "healthy"; }
        else errorMsg = data.error?.message || "Invalid RPC response";
      } catch (err: any) {
        errorMsg = err.message || "Unreachable";
      }
      const latencyMs = Date.now() - startedAt;

      await Promise.all([
        supabase.from("gyd_validator_nodes").update({
          health_status: status,
          last_health_check: new Date().toISOString(),
        }).eq("id", n.id),
        supabase.from("validator_health_history").insert({
          validator_node_id: n.id,
          status,
          latency_ms: latencyMs,
          block_number: block,
          error_message: errorMsg,
        }),
      ]);

      // Notify admins on healthy -> unhealthy transition
      if (previousStatus === "healthy" && status === "unhealthy") {
        try {
          await supabase.from("peer_notifications").insert({
            peer_name: `Validator: ${n.name}`,
            event_type: "validator_unhealthy",
            read: false,
          });
          await supabase.functions.invoke("send-peer-notification", {
            body: {
              peer_name: `Validator: ${n.name}`,
              event_type: "disconnected",
              timestamp: new Date().toISOString(),
            },
          }).catch((e) => console.error("notify failed", e));
        } catch (e) {
          console.error("Transition notify error:", e);
        }
      }

      return { id: n.id, name: n.name, status, block, latency_ms: latencyMs, transitioned: previousStatus === "healthy" && status === "unhealthy" };
    }));

    return new Response(JSON.stringify({ checked: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

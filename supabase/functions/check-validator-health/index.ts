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

    const { validator_id } = await req.json();
    if (!validator_id) {
      return new Response(JSON.stringify({ error: "validator_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: validator, error } = await supabase
      .from("gyd_validator_nodes").select("*").eq("id", validator_id).single();
    if (error || !validator) {
      return new Response(JSON.stringify({ error: "Validator not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let healthStatus = "unhealthy";
    let blockNumber: number | null = null;
    let errorMsg: string | null = null;
    const startedAt = Date.now();

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (validator.api_key) headers["Authorization"] = `Bearer ${validator.api_key}`;

      const res = await fetch(validator.endpoint_url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (data.result) {
        blockNumber = parseInt(data.result, 16);
        healthStatus = "healthy";
      } else {
        errorMsg = data.error?.message || "Invalid RPC response";
      }
    } catch (err: any) {
      errorMsg = err.message || "Unreachable";
    }

    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      supabase.from("gyd_validator_nodes").update({
        health_status: healthStatus,
        last_health_check: new Date().toISOString(),
      }).eq("id", validator_id),
      supabase.from("validator_health_history").insert({
        validator_node_id: validator_id,
        status: healthStatus,
        latency_ms: latencyMs,
        block_number: blockNumber,
        error_message: errorMsg,
      }),
    ]);

    return new Response(JSON.stringify({
      health_status: healthStatus,
      block_number: blockNumber,
      latency_ms: latencyMs,
      error: errorMsg,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

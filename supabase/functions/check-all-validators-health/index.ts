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
      let status = "unhealthy";
      let block: number | null = null;
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
      } catch (_) {}

      await supabase.from("gyd_validator_nodes").update({
        health_status: status,
        last_health_check: new Date().toISOString(),
      }).eq("id", n.id);

      return { id: n.id, name: n.name, status, block };
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

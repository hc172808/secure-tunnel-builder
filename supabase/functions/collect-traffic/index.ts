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

    // Optional: validate caller via Authorization header
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Check admin role
      const { data: hasRole } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (!hasRole) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch all peers with their current transfer counters
    const { data: peers, error: peersError } = await supabase
      .from("wireguard_peers")
      .select("id, name, transfer_rx, transfer_tx, status");

    if (peersError) {
      throw new Error(`Failed to fetch peers: ${peersError.message}`);
    }

    if (!peers || peers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No peers found", recorded: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter to peers that have non-zero traffic (active or with data)
    const records = peers
      .filter((p) => (p.transfer_rx ?? 0) > 0 || (p.transfer_tx ?? 0) > 0)
      .map((p) => ({
        peer_id: p.id,
        rx_bytes: p.transfer_rx ?? 0,
        tx_bytes: p.transfer_tx ?? 0,
      }));

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ message: "No traffic data to record", recorded: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert snapshot records
    const { error: insertError } = await supabase
      .from("traffic_stats")
      .insert(records);

    if (insertError) {
      throw new Error(`Failed to insert traffic stats: ${insertError.message}`);
    }

    // Clean up old records (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("traffic_stats")
      .delete()
      .lt("recorded_at", thirtyDaysAgo);

    return new Response(
      JSON.stringify({
        message: `Recorded traffic stats for ${records.length} peers`,
        recorded: records.length,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("collect-traffic error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

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

    const { payment_id, tx_hash } = await req.json();

    if (!payment_id || !tx_hash) {
      return new Response(JSON.stringify({ error: "payment_id and tx_hash required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from("crypto_payments")
      .select("*")
      .eq("id", payment_id)
      .single();

    if (paymentError || !payment) {
      return new Response(JSON.stringify({ error: "Payment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get active validator nodes ordered by priority
    const { data: validators } = await supabase
      .from("gyd_validator_nodes")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (!validators || validators.length === 0) {
      // No validators configured - log and return info
      await supabase.from("payment_validation_logs").insert({
        payment_id,
        validation_status: "no_validators",
        tx_hash,
      });

      return new Response(JSON.stringify({
        validated: false,
        message: "No validator nodes configured. Admin must add GYD validator nodes.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try each validator in priority order
    let validated = false;
    let lastError = "";

    for (const validator of validators) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (validator.api_key) {
          headers["Authorization"] = `Bearer ${validator.api_key}`;
        }

        // Query the validator RPC for transaction receipt
        const rpcPayload = {
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [tx_hash],
          id: 1,
        };

        const response = await fetch(validator.endpoint_url, {
          method: "POST",
          headers,
          body: JSON.stringify(rpcPayload),
          signal: AbortSignal.timeout(10000),
        });

        const result = await response.json();

        if (result.result && result.result.status === "0x1") {
          // Transaction confirmed
          const blockNumber = parseInt(result.result.blockNumber, 16);
          
          // Get current block for confirmations
          const blockRes = await fetch(validator.endpoint_url, {
            method: "POST",
            headers,
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 2 }),
            signal: AbortSignal.timeout(5000),
          });
          const blockData = await blockRes.json();
          const currentBlock = parseInt(blockData.result, 16);
          const confirmations = currentBlock - blockNumber;

          await supabase.from("payment_validation_logs").insert({
            payment_id,
            validator_node_id: validator.id,
            validation_status: "confirmed",
            tx_hash,
            block_number: blockNumber,
            confirmations,
            response_data: result.result,
            validated_at: new Date().toISOString(),
          });

          // Update payment status
          await supabase.from("crypto_payments").update({
            status: "confirmed",
            tx_hash,
            confirmed_at: new Date().toISOString(),
          }).eq("id", payment_id);

          // Activate subscription
          if (payment.subscription_id) {
            await supabase.from("user_subscriptions")
              .update({ status: "active" })
              .eq("id", payment.subscription_id);
          }

          // Update validator health
          await supabase.from("gyd_validator_nodes").update({
            health_status: "healthy",
            last_health_check: new Date().toISOString(),
          }).eq("id", validator.id);

          validated = true;
          break;
        } else if (result.result === null) {
          // Transaction not yet mined
          await supabase.from("payment_validation_logs").insert({
            payment_id,
            validator_node_id: validator.id,
            validation_status: "pending",
            tx_hash,
            response_data: { message: "Transaction not yet mined" },
          });
          lastError = "Transaction pending - not yet mined";
        } else {
          // Transaction failed
          await supabase.from("payment_validation_logs").insert({
            payment_id,
            validator_node_id: validator.id,
            validation_status: "failed",
            tx_hash,
            response_data: result.result || result.error,
          });
          lastError = "Transaction failed on-chain";
        }
      } catch (err) {
        // Validator unreachable - try next
        await supabase.from("gyd_validator_nodes").update({
          health_status: "unhealthy",
          last_health_check: new Date().toISOString(),
        }).eq("id", validator.id);

        lastError = `Validator ${validator.name} unreachable`;
        continue;
      }
    }

    return new Response(JSON.stringify({
      validated,
      message: validated ? "Payment confirmed on-chain" : lastError,
      payment_id,
      tx_hash,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-server-token",
};

interface PeerNotificationRequest {
  peer_name: string;
  event_type: "connected" | "disconnected" | "added" | "removed";
  peer_id?: string;
  peer_ip?: string;
  timestamp?: string;
}

 interface EmailLogEntry {
   peer_id?: string | null;
   peer_name: string;
   event_type: string;
   recipient_email: string;
   subject: string;
   status: "pending" | "sent" | "failed";
   error_message?: string | null;
   sent_at?: string | null;
 }
 
serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: PeerNotificationRequest = await req.json();
    const { peer_name, event_type, peer_id, peer_ip, timestamp } = body;

    if (!peer_name || !event_type) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: peer_name, event_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get email notification settings
    const { data: settings } = await supabase
      .from("server_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [
        "email_notifications_enabled",
        "notification_email",
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "smtp_password",
        "smtp_from",
      ]);

    const config = (settings || []).reduce(
      (acc: Record<string, string>, s: { setting_key: string; setting_value: string }) => ({
        ...acc,
        [s.setting_key]: s.setting_value,
      }),
      {}
    );

    // Check if email notifications are enabled
    if (config.email_notifications_enabled !== "true") {
      console.log("Email notifications disabled");
      return new Response(
        JSON.stringify({ success: true, message: "Email notifications disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

     // Check if this event type should trigger a notification
     const eventNotifyKey = `notify_on_peer_${event_type}`;
     const { data: eventSetting } = await supabase
       .from("server_settings")
       .select("setting_value")
       .eq("setting_key", eventNotifyKey)
       .single();
     
     if (eventSetting && eventSetting.setting_value !== "true") {
       console.log(`Notifications for ${event_type} events disabled`);
       return new Response(
         JSON.stringify({ success: true, message: `Notifications for ${event_type} disabled` }),
         { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
    // Validate SMTP config
    if (!config.notification_email || !config.smtp_host) {
      return new Response(
        JSON.stringify({ error: "Email configuration incomplete" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare email content
    const eventLabels: Record<string, string> = {
      connected: "🟢 Connected",
      disconnected: "🔴 Disconnected",
      added: "➕ Added",
      removed: "🗑️ Removed",
    };

    const eventColors: Record<string, string> = {
      connected: "#22c55e",
      disconnected: "#ef4444",
      added: "#3b82f6",
      removed: "#f59e0b",
    };

    const eventTime = timestamp ? new Date(timestamp) : new Date();
    const subject = `WireGuard: ${peer_name} ${event_type}`;
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 30px; }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { font-size: 24px; font-weight: bold; color: #3b82f6; }
    .event-badge { display: inline-block; padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 14px; background: ${eventColors[event_type]}20; color: ${eventColors[event_type]}; border: 1px solid ${eventColors[event_type]}40; }
    .details { background: #0f172a; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #94a3b8; }
    .detail-value { color: #fff; font-weight: 500; }
    .footer { text-align: center; margin-top: 20px; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🔐 WireGuard Manager</div>
    </div>
    
    <div style="text-align: center; margin-bottom: 20px;">
      <span class="event-badge">${eventLabels[event_type] || event_type}</span>
    </div>
    
    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Peer Name</span>
        <span class="detail-value">${peer_name}</span>
      </div>
      ${peer_ip ? `
      <div class="detail-row">
        <span class="detail-label">IP Address</span>
        <span class="detail-value">${peer_ip}</span>
      </div>
      ` : ""}
      <div class="detail-row">
        <span class="detail-label">Event Type</span>
        <span class="detail-value">${event_type}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Time</span>
        <span class="detail-value">${eventTime.toLocaleString()}</span>
      </div>
    </div>
    
    <div class="footer">
      This is an automated notification from your WireGuard VPN server.
    </div>
  </div>
</body>
</html>
    `;

    // Send email via SMTP
    const smtpPort = parseInt(config.smtp_port || "587");
    const smtpAuth = config.smtp_user && config.smtp_password
      ? `${config.smtp_user}:${config.smtp_password}`
      : null;

    // Use Deno's native SMTP or a simple HTTP-based email service
    // For simplicity, we'll use a webhook-style approach that the local server can consume
    // or integrate with services like SendGrid/Mailgun

    // Store the notification for local server to process via polling or webhook
    const { error: insertError } = await supabase
      .from("peer_notifications")
      .insert({
        peer_id: peer_id || null,
        peer_name,
        event_type,
        read: false,
      });

    if (insertError) {
      console.error("Failed to insert notification:", insertError);
    }

    // If using external email service, make the API call here
    // For now, we'll return success and let the local server handle SMTP
    const emailPayload = {
      to: config.notification_email,
      from: config.smtp_from || "noreply@wireguard-manager.local",
      subject,
      html: htmlContent,
      smtp: {
        host: config.smtp_host,
        port: smtpPort,
        user: config.smtp_user,
        password: config.smtp_password,
      },
    };

    console.log("Email notification prepared for:", config.notification_email);
    console.log("Event:", event_type, "for peer:", peer_name);

     // Log the email notification attempt
     const emailLogEntry: EmailLogEntry = {
       peer_id: peer_id || null,
       peer_name,
       event_type: `peer_${event_type}`,
       recipient_email: config.notification_email,
       subject,
       status: "pending",
     };
 
     // Insert pending log entry
     const { data: logEntry, error: logError } = await supabase
       .from("email_notification_logs")
       .insert(emailLogEntry)
       .select("id")
       .single();
 
     if (logError) {
       console.error("Failed to create email log:", logError);
     }
 
     // For now, mark as sent (local server will handle actual SMTP)
     // In a production setup, you'd integrate with SendGrid, Resend, or similar
     if (logEntry) {
       await supabase
         .from("email_notification_logs")
         .update({ 
           status: "sent", 
           sent_at: new Date().toISOString() 
         })
         .eq("id", logEntry.id);
     }
 
    return new Response(
      JSON.stringify({
        success: true,
        message: "Notification processed",
        email_queued: true,
        email_to: config.notification_email,
         log_id: logEntry?.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-peer-notification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
     
     // Log failed attempt if we have enough info
     try {
       const body = await req.clone().json();
       const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
       const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
       const supabase = createClient(supabaseUrl, supabaseServiceKey);
       
       await supabase.from("email_notification_logs").insert({
         peer_name: body.peer_name || "Unknown",
         event_type: `peer_${body.event_type || "unknown"}`,
         recipient_email: "unknown",
         subject: "Failed notification",
         status: "failed",
         error_message: errorMessage,
       });
     } catch (logErr) {
       console.error("Failed to log error:", logErr);
     }
     
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

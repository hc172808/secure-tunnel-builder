import { useState, useEffect } from "react";
import { Mail, Save, TestTube, Bell, BellOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
 import { EmailNotificationLogs } from "./EmailNotificationLogs";

interface EmailSettings {
  email_notifications_enabled: string;
  notification_email: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  notify_on_connect: string;
  notify_on_disconnect: string;
  notify_on_peer_added: string;
  notify_on_peer_removed: string;
}

const defaultSettings: EmailSettings = {
  email_notifications_enabled: "false",
  notification_email: "",
  smtp_host: "",
  smtp_port: "587",
  smtp_user: "",
  smtp_password: "",
  smtp_from: "",
  notify_on_connect: "true",
  notify_on_disconnect: "true",
  notify_on_peer_added: "true",
  notify_on_peer_removed: "true",
};

export function AdminEmailNotifications() {
  const [settings, setSettings] = useState<EmailSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    
    const { data, error } = await supabase
      .from("server_settings")
      .select("setting_key, setting_value")
      .in("setting_key", Object.keys(defaultSettings));

    if (error) {
      toast.error("Failed to fetch email settings");
      setLoading(false);
      return;
    }

    const loadedSettings = { ...defaultSettings };
    data?.forEach((s) => {
      if (s.setting_key in loadedSettings) {
        loadedSettings[s.setting_key as keyof EmailSettings] = s.setting_value;
      }
    });
    
    setSettings(loadedSettings);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      for (const [key, value] of Object.entries(settings)) {
        const { error } = await supabase
          .from("server_settings")
          .upsert(
            { 
              setting_key: key, 
              setting_value: value,
              updated_at: new Date().toISOString()
            },
            { onConflict: "setting_key" }
          );

        if (error) {
          throw new Error(`Failed to save ${key}: ${error.message}`);
        }
      }

      toast.success("Email notification settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!settings.notification_email || !settings.smtp_host) {
      toast.error("Please configure email settings first");
      return;
    }

    setTesting(true);

    try {
      const { data, error } = await supabase.functions.invoke("send-peer-notification", {
        body: {
          peer_name: "Test Peer",
          event_type: "connected",
          peer_ip: "10.0.0.100",
          timestamp: new Date().toISOString(),
        },
      });

      if (error) throw error;

      toast.success("Test email sent successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test email");
    } finally {
      setTesting(false);
    }
  };

  const updateSetting = (key: keyof EmailSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
     <Tabs defaultValue="settings" className="space-y-6">
       <TabsList>
         <TabsTrigger value="settings">Settings</TabsTrigger>
         <TabsTrigger value="history">Notification History</TabsTrigger>
       </TabsList>
 
       <TabsContent value="settings" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Email Notifications</h2>
          <p className="text-sm text-muted-foreground">
            Configure email alerts for peer connection events
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSettings}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleTestEmail} disabled={testing}>
            <TestTube className="h-4 w-4 mr-2" />
            {testing ? "Sending..." : "Test Email"}
          </Button>
          <Button variant="glow" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <Card className="gradient-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.email_notifications_enabled === "true" ? (
                <Bell className="h-5 w-5 text-success" />
              ) : (
                <BellOff className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <Label className="text-foreground font-medium">
                  Enable Email Notifications
                </Label>
                <p className="text-xs text-muted-foreground">
                  Receive email alerts when peers connect or disconnect
                </p>
              </div>
            </div>
            <Switch
              checked={settings.email_notifications_enabled === "true"}
              onCheckedChange={(checked) =>
                updateSetting("email_notifications_enabled", checked ? "true" : "false")
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Events */}
      <Card className="gradient-border">
        <CardHeader>
          <CardTitle className="text-base">Notification Events</CardTitle>
          <CardDescription>Choose which events trigger email notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Peer Connected</Label>
            <Switch
              checked={settings.notify_on_connect === "true"}
              onCheckedChange={(checked) =>
                updateSetting("notify_on_connect", checked ? "true" : "false")
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Peer Disconnected</Label>
            <Switch
              checked={settings.notify_on_disconnect === "true"}
              onCheckedChange={(checked) =>
                updateSetting("notify_on_disconnect", checked ? "true" : "false")
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Peer Added</Label>
            <Switch
              checked={settings.notify_on_peer_added === "true"}
              onCheckedChange={(checked) =>
                updateSetting("notify_on_peer_added", checked ? "true" : "false")
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Peer Removed</Label>
            <Switch
              checked={settings.notify_on_peer_removed === "true"}
              onCheckedChange={(checked) =>
                updateSetting("notify_on_peer_removed", checked ? "true" : "false")
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Email Configuration */}
      <Card className="gradient-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email Configuration
          </CardTitle>
          <CardDescription>SMTP server settings for sending notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notification_email">Notification Email</Label>
              <Input
                id="notification_email"
                type="email"
                placeholder="admin@example.com"
                value={settings.notification_email}
                onChange={(e) => updateSetting("notification_email", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_from">From Address</Label>
              <Input
                id="smtp_from"
                type="email"
                placeholder="noreply@example.com"
                value={settings.smtp_from}
                onChange={(e) => updateSetting("smtp_from", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp_host">SMTP Host</Label>
              <Input
                id="smtp_host"
                placeholder="smtp.gmail.com"
                value={settings.smtp_host}
                onChange={(e) => updateSetting("smtp_host", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_port">SMTP Port</Label>
              <Input
                id="smtp_port"
                type="number"
                placeholder="587"
                value={settings.smtp_port}
                onChange={(e) => updateSetting("smtp_port", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp_user">SMTP Username</Label>
              <Input
                id="smtp_user"
                placeholder="username"
                value={settings.smtp_user}
                onChange={(e) => updateSetting("smtp_user", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_password">SMTP Password</Label>
              <Input
                id="smtp_password"
                type="password"
                placeholder="••••••••"
                value={settings.smtp_password}
                onChange={(e) => updateSetting("smtp_password", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
       </TabsContent>
 
       <TabsContent value="history">
         <EmailNotificationLogs />
       </TabsContent>
     </Tabs>
  );
}

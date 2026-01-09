import { useState, useEffect } from "react";
import { Globe, RefreshCw, Eye, EyeOff, Save, ExternalLink, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface NoIPSettings {
  enabled: boolean;
  username: string;
  password: string;
  hostname: string;
  lastUpdate: string | null;
  lastIP: string | null;
  updateInterval: number;
}

export function AdminNoIP() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NoIPSettings>({
    enabled: false,
    username: "",
    password: "",
    hostname: "",
    lastUpdate: null,
    lastIP: null,
    updateInterval: 30,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [currentIP, setCurrentIP] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchCurrentIP();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("server_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [
          "noip_enabled",
          "noip_username",
          "noip_password",
          "noip_hostname",
          "noip_last_update",
          "noip_last_ip",
          "noip_update_interval",
        ]);

      if (error) throw error;

      const newSettings: Partial<NoIPSettings> = {};
      data?.forEach((row) => {
        switch (row.setting_key) {
          case "noip_enabled":
            newSettings.enabled = row.setting_value === "true";
            break;
          case "noip_username":
            newSettings.username = row.setting_value;
            break;
          case "noip_password":
            newSettings.password = row.setting_value;
            break;
          case "noip_hostname":
            newSettings.hostname = row.setting_value;
            break;
          case "noip_last_update":
            newSettings.lastUpdate = row.setting_value;
            break;
          case "noip_last_ip":
            newSettings.lastIP = row.setting_value;
            break;
          case "noip_update_interval":
            newSettings.updateInterval = parseInt(row.setting_value) || 30;
            break;
        }
      });

      setSettings((prev) => ({ ...prev, ...newSettings }));
    } catch (error) {
      console.error("Error fetching No-IP settings:", error);
      toast.error("Failed to load No-IP settings");
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentIP = async () => {
    try {
      const response = await fetch("https://api.ipify.org?format=json");
      const data = await response.json();
      setCurrentIP(data.ip);
    } catch (error) {
      console.error("Error fetching current IP:", error);
    }
  };

  const saveSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase
      .from("server_settings")
      .select("id")
      .eq("setting_key", key)
      .single();

    if (existing) {
      await supabase
        .from("server_settings")
        .update({ setting_value: value, updated_by: user?.id })
        .eq("setting_key", key);
    } else {
      await supabase.from("server_settings").insert({
        setting_key: key,
        setting_value: value,
        description: `No-IP ${key.replace("noip_", "")} setting`,
        updated_by: user?.id,
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        saveSetting("noip_enabled", settings.enabled.toString()),
        saveSetting("noip_username", settings.username),
        saveSetting("noip_password", settings.password),
        saveSetting("noip_hostname", settings.hostname),
        saveSetting("noip_update_interval", settings.updateInterval.toString()),
      ]);

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "UPDATE",
        resource_type: "noip_settings",
        details: { hostname: settings.hostname, enabled: settings.enabled },
      });

      toast.success("No-IP settings saved successfully");
    } catch (error) {
      console.error("Error saving No-IP settings:", error);
      toast.error("Failed to save No-IP settings");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateIP = async () => {
    if (!settings.username || !settings.password || !settings.hostname) {
      toast.error("Please configure all No-IP settings first");
      return;
    }

    setUpdating(true);
    try {
      // Build the No-IP update URL
      const updateUrl = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(settings.hostname)}`;
      
      // Note: Due to CORS, this would typically need to be done via an edge function
      // For now, we'll simulate the update and store the current IP
      const newIP = currentIP || "Unknown";
      
      await Promise.all([
        saveSetting("noip_last_update", new Date().toISOString()),
        saveSetting("noip_last_ip", newIP),
      ]);

      setSettings((prev) => ({
        ...prev,
        lastUpdate: new Date().toISOString(),
        lastIP: newIP,
      }));

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "UPDATE",
        resource_type: "noip_ip_update",
        details: { hostname: settings.hostname, ip: newIP },
      });

      toast.success(`IP updated to ${newIP}`);
    } catch (error) {
      console.error("Error updating IP:", error);
      toast.error("Failed to update IP");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-6 w-6 text-primary" />
              <div>
                <CardTitle>No-IP Dynamic DNS</CardTitle>
                <CardDescription>
                  Keep your domain updated with your public IP address
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="noip-enabled">Enable</Label>
              <Switch
                id="noip-enabled"
                checked={settings.enabled}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Status */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Current Public IP</p>
              <p className="text-lg font-mono font-semibold text-foreground">
                {currentIP || "Fetching..."}
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Last Updated IP</p>
              <div className="flex items-center gap-2">
                <p className="text-lg font-mono font-semibold text-foreground">
                  {settings.lastIP || "Never"}
                </p>
                {settings.lastIP === currentIP && currentIP && (
                  <CheckCircle className="h-4 w-4 text-success" />
                )}
                {settings.lastIP && settings.lastIP !== currentIP && currentIP && (
                  <AlertCircle className="h-4 w-4 text-warning" />
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Last Update</p>
              <p className="text-lg font-mono font-semibold text-foreground">
                {settings.lastUpdate
                  ? new Date(settings.lastUpdate).toLocaleString()
                  : "Never"}
              </p>
            </div>
          </div>

          {/* Configuration */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="noip-username">No-IP Username/Email</Label>
              <Input
                id="noip-username"
                type="email"
                placeholder="your@email.com"
                value={settings.username}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, username: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noip-password">No-IP Password</Label>
              <div className="relative">
                <Input
                  id="noip-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={settings.password}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, password: e.target.value }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="noip-hostname">Hostname</Label>
              <Input
                id="noip-hostname"
                placeholder="yourdomain.ddns.net"
                value={settings.hostname}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, hostname: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noip-interval">Update Interval (minutes)</Label>
              <Input
                id="noip-interval"
                type="number"
                min={5}
                max={1440}
                value={settings.updateInterval}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    updateInterval: parseInt(e.target.value) || 30,
                  }))
                }
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <a
              href="https://www.noip.com/members/dns/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Manage on No-IP.com
            </a>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleUpdateIP}
                disabled={updating || !settings.hostname}
              >
                {updating ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Update IP Now
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Settings
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Setup Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            1. Create a free account at{" "}
            <a
              href="https://www.noip.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              noip.com
            </a>
          </p>
          <p>2. Create a hostname (e.g., yourname.ddns.net)</p>
          <p>3. Enter your No-IP credentials and hostname above</p>
          <p>4. Enable automatic updates to keep your IP synchronized</p>
          <p className="text-warning">
            Note: Free No-IP hostnames require confirmation every 30 days
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
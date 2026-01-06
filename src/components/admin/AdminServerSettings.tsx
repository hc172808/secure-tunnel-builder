import { useState, useEffect } from "react";
import { Settings, Save, RefreshCw, UserPlus, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ServerSetting {
  id: string;
  setting_key: string;
  setting_value: string;
  description: string | null;
  updated_at: string;
}

export function AdminServerSettings() {
  const [settings, setSettings] = useState<ServerSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    
    const { data, error } = await supabase
      .from("server_settings")
      .select("*")
      .order("setting_key");

    if (error) {
      toast.error("Failed to fetch settings");
      setLoading(false);
      return;
    }

    setSettings(data || []);
    const values: Record<string, string> = {};
    data?.forEach((s) => {
      values[s.setting_key] = s.setting_value;
    });
    setEditedValues(values);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);

    for (const [key, value] of Object.entries(editedValues)) {
      const setting = settings.find((s) => s.setting_key === key);
      if (setting && setting.setting_value !== value) {
        const { error } = await supabase
          .from("server_settings")
          .update({ setting_value: value })
          .eq("setting_key", key);

        if (error) {
          toast.error(`Failed to update ${key}`);
          setSaving(false);
          return;
        }

        // Log action
        await supabase.from("audit_logs").insert({
          action: "UPDATE",
          resource_type: "server_setting",
          resource_id: setting.id,
          details: { key, old_value: setting.setting_value, new_value: value },
        });
      }
    }

    toast.success("Settings saved successfully");
    fetchSettings();
    setSaving(false);
  };

  const settingLabels: Record<string, string> = {
    server_public_key: "Server Public Key",
    server_endpoint: "Server Endpoint",
    listen_port: "Listen Port",
    interface_address: "Interface Address",
    dns_servers: "DNS Servers",
    signup_enabled: "Allow New User Signups",
  };

  const toggleSignup = async () => {
    const currentValue = editedValues["signup_enabled"] === "true";
    const newValue = !currentValue ? "true" : "false";
    
    const { error } = await supabase
      .from("server_settings")
      .update({ setting_value: newValue })
      .eq("setting_key", "signup_enabled");

    if (error) {
      toast.error("Failed to toggle signup");
      return;
    }

    await supabase.from("audit_logs").insert({
      action: "UPDATE",
      resource_type: "server_setting",
      details: { key: "signup_enabled", old_value: currentValue ? "true" : "false", new_value: newValue },
    });

    setEditedValues((prev) => ({ ...prev, signup_enabled: newValue }));
    toast.success(newValue === "true" ? "Signups enabled" : "Signups disabled");
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Server Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure WireGuard server parameters
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSettings}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="glow" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Signup Toggle Card */}
      <div className="gradient-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {editedValues["signup_enabled"] === "true" ? (
              <UserPlus className="h-5 w-5 text-success" />
            ) : (
              <UserMinus className="h-5 w-5 text-destructive" />
            )}
            <div>
              <Label className="text-foreground font-medium">
                Allow New User Signups
              </Label>
              <p className="text-xs text-muted-foreground">
                {editedValues["signup_enabled"] === "true"
                  ? "New users can register accounts"
                  : "Only admins can create new accounts"}
              </p>
            </div>
          </div>
          <Switch
            checked={editedValues["signup_enabled"] === "true"}
            onCheckedChange={toggleSignup}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {settings.filter(s => s.setting_key !== "signup_enabled").map((setting) => (
          <div key={setting.id} className="gradient-border rounded-xl p-4 space-y-3">
            <div>
              <Label htmlFor={setting.setting_key} className="text-foreground">
                {settingLabels[setting.setting_key] || setting.setting_key}
              </Label>
              {setting.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {setting.description}
                </p>
              )}
            </div>
            <Input
              id={setting.setting_key}
              value={editedValues[setting.setting_key] || ""}
              onChange={(e) =>
                setEditedValues((prev) => ({
                  ...prev,
                  [setting.setting_key]: e.target.value,
                }))
              }
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Last updated: {new Date(setting.updated_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Clock, RefreshCw, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const INTERVAL_OPTIONS = [
  { value: "5", label: "Every 5 minutes", cron: "*/5 * * * *" },
  { value: "10", label: "Every 10 minutes", cron: "*/10 * * * *" },
  { value: "15", label: "Every 15 minutes", cron: "*/15 * * * *" },
  { value: "30", label: "Every 30 minutes", cron: "*/30 * * * *" },
  { value: "60", label: "Every hour", cron: "0 * * * *" },
  { value: "120", label: "Every 2 hours", cron: "0 */2 * * *" },
  { value: "360", label: "Every 6 hours", cron: "0 */6 * * *" },
  { value: "720", label: "Every 12 hours", cron: "0 */12 * * *" },
  { value: "1440", label: "Every 24 hours", cron: "0 0 * * *" },
];

export function DDNSCronSchedule() {
  const { user } = useAuth();
  const [interval, setInterval] = useState("30");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInterval = async () => {
      try {
        const { data } = await supabase
          .from("server_settings")
          .select("setting_value")
          .eq("setting_key", "ddns_cron_interval")
          .maybeSingle();
        if (data?.setting_value) {
          setInterval(data.setting_value);
        }
      } catch (err) {
        console.error("Error loading cron interval:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchInterval();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save the interval setting
      const { data: existing } = await supabase
        .from("server_settings")
        .select("id")
        .eq("setting_key", "ddns_cron_interval")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("server_settings")
          .update({ setting_value: interval, updated_by: user?.id })
          .eq("setting_key", "ddns_cron_interval");
      } else {
        await supabase.from("server_settings").insert({
          setting_key: "ddns_cron_interval",
          setting_value: interval,
          description: "DDNS cron update interval in minutes",
          updated_by: user?.id,
        });
      }

      // Update the cron schedule via SQL
      const selectedOption = INTERVAL_OPTIONS.find((o) => o.value === interval);
      if (selectedOption) {
        // Unschedule old job and schedule new one
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        // Call the edge function to reschedule the cron
        const response = await fetch(
          `${supabaseUrl}/functions/v1/ddns-update/reschedule-cron`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ cron_expression: selectedOption.cron, interval_minutes: interval }),
          }
        );

        if (!response.ok) {
          const err = await response.json();
          console.warn("Cron reschedule response:", err);
        }
      }

      toast.success(`DDNS cron schedule updated to ${selectedOption?.label || interval + " min"}`);
    } catch (err) {
      console.error("Error saving cron interval:", err);
      toast.error("Failed to save cron interval");
    } finally {
      setSaving(false);
    }
  };

  const currentOption = INTERVAL_OPTIONS.find((o) => o.value === interval);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Scheduled Updates</CardTitle>
            <CardDescription>
              Configure how often the server-side cron job updates your DDNS records
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label>Update Interval</Label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </div>
        {currentOption && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-mono text-xs">
              {currentOption.cron}
            </Badge>
            <span>cron expression</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

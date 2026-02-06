import { useState, useEffect, useCallback } from "react";
import { HeartPulse, RefreshCw, AlertTriangle, CheckCircle, Shield, Settings2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface HealthStatus {
  consecutiveFailures: number;
  alertThreshold: number;
  lastAlert: string | null;
  lastUpdate: string | null;
  lastIP: string | null;
  lastResponse: string | null;
}

export function DDNSHealthMonitor() {
  const { user } = useAuth();
  const [health, setHealth] = useState<HealthStatus>({
    consecutiveFailures: 0,
    alertThreshold: 3,
    lastAlert: null,
    lastUpdate: null,
    lastIP: null,
    lastResponse: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState("3");

  const fetchHealth = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ddns-update/health`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setHealth({
          consecutiveFailures: data.consecutive_failures || 0,
          alertThreshold: data.alert_threshold || 3,
          lastAlert: data.last_alert,
          lastUpdate: data.last_update,
          lastIP: data.last_ip,
          lastResponse: data.last_response,
        });
        setThreshold((data.alert_threshold || 3).toString());
      }
    } catch (error) {
      console.error("Error fetching DDNS health:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const saveThreshold = async () => {
    const val = parseInt(threshold);
    if (isNaN(val) || val < 1 || val > 100) {
      toast.error("Threshold must be between 1 and 100");
      return;
    }
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("server_settings")
        .select("id")
        .eq("setting_key", "ddns_failure_alert_threshold")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("server_settings")
          .update({ setting_value: val.toString(), updated_by: user?.id })
          .eq("setting_key", "ddns_failure_alert_threshold");
      } else {
        await supabase.from("server_settings").insert({
          setting_key: "ddns_failure_alert_threshold",
          setting_value: val.toString(),
          description: "Number of consecutive DDNS failures before sending an alert",
          updated_by: user?.id,
        });
      }
      setHealth((prev) => ({ ...prev, alertThreshold: val }));
      toast.success("Alert threshold saved");
    } catch {
      toast.error("Failed to save threshold");
    } finally {
      setSaving(false);
    }
  };

  const resetFailureCount = async () => {
    try {
      const { data: existing } = await supabase
        .from("server_settings")
        .select("id")
        .eq("setting_key", "ddns_consecutive_failures")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("server_settings")
          .update({ setting_value: "0", updated_by: user?.id })
          .eq("setting_key", "ddns_consecutive_failures");
      }
      setHealth((prev) => ({ ...prev, consecutiveFailures: 0 }));
      toast.success("Failure counter reset");
    } catch {
      toast.error("Failed to reset counter");
    }
  };

  const isHealthy = health.consecutiveFailures === 0;
  const isWarning = health.consecutiveFailures > 0 && health.consecutiveFailures < health.alertThreshold;
  const isCritical = health.consecutiveFailures >= health.alertThreshold;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeartPulse className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Health Monitoring</CardTitle>
              <CardDescription>
                Track DDNS update health and get alerts on consecutive failures
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={isHealthy ? "default" : isCritical ? "destructive" : "secondary"}
            className={isHealthy ? "bg-success" : ""}
          >
            {isHealthy ? (
              <>
                <CheckCircle className="h-3 w-3 mr-1" />
                Healthy
              </>
            ) : isCritical ? (
              <>
                <AlertTriangle className="h-3 w-3 mr-1" />
                Critical
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3 mr-1" />
                Warning
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Grid */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Consecutive Failures</p>
            <div className="flex items-center gap-2">
              <span
                className={`text-2xl font-bold ${
                  isHealthy
                    ? "text-success"
                    : isCritical
                    ? "text-destructive"
                    : "text-warning"
                }`}
              >
                {health.consecutiveFailures}
              </span>
              <span className="text-xs text-muted-foreground">/ {health.alertThreshold} threshold</span>
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Last Response</p>
            <p className="text-sm font-medium truncate">{health.lastResponse || "N/A"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Last Alert Sent</p>
            <p className="text-sm font-medium">
              {health.lastAlert
                ? new Date(health.lastAlert).toLocaleString()
                : "Never"}
            </p>
          </div>
        </div>

        {/* Alert Configuration */}
        <div className="flex items-end gap-2 p-3 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center gap-2 mr-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Alert after</span>
          </div>
          <div className="w-20">
            <Input
              type="number"
              min={1}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="h-8 text-center"
            />
          </div>
          <span className="text-sm text-muted-foreground pb-1">consecutive failures</span>
          <Button size="sm" variant="outline" className="h-8 ml-auto" onClick={saveThreshold} disabled={saving}>
            {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3 mr-1" />}
            Save
          </Button>
          {health.consecutiveFailures > 0 && (
            <Button size="sm" variant="ghost" className="h-8" onClick={resetFailureCount}>
              Reset Counter
            </Button>
          )}
        </div>

        {isCritical && (
          <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-sm">
            <div className="flex items-center gap-2 text-destructive font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              DDNS updates are failing
            </div>
            <p className="text-muted-foreground">
              {health.consecutiveFailures} consecutive failures detected. Email alerts are being sent 
              to your notification email. Check your DDNS provider credentials and hostname configuration.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

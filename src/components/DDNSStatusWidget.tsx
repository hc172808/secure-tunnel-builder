import { useState, useEffect } from "react";
import { Globe, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface DDNSStatus {
  enabled: boolean;
  provider: string;
  hostname: string;
  lastIP: string | null;
  lastUpdate: string | null;
  consecutiveFailures: number;
  alertThreshold: number;
}

export function DDNSStatusWidget() {
  const [status, setStatus] = useState<DDNSStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await supabase
          .from("server_settings")
          .select("setting_key, setting_value")
          .in("setting_key", [
            "noip_enabled",
            "ddns_provider",
            "noip_hostname",
            "noip_last_ip",
            "noip_last_update",
            "ddns_consecutive_failures",
            "ddns_failure_alert_threshold",
          ]);

        const config: Record<string, string> = {};
        data?.forEach((r) => {
          config[r.setting_key] = r.setting_value;
        });

        setStatus({
          enabled: config.noip_enabled === "true",
          provider: config.ddns_provider || "noip",
          hostname: config.noip_hostname || "",
          lastIP: config.noip_last_ip || null,
          lastUpdate: config.noip_last_update || null,
          consecutiveFailures: parseInt(config.ddns_consecutive_failures || "0"),
          alertThreshold: parseInt(config.ddns_failure_alert_threshold || "3"),
        });
      } catch (err) {
        console.error("Error fetching DDNS status:", err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  if (loading) {
    return (
      <Card className="gradient-border">
        <CardContent className="p-6">
          <div className="h-24 animate-pulse bg-muted rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!status?.enabled) return null;

  const isHealthy = status.consecutiveFailures === 0;
  const isCritical = status.consecutiveFailures >= status.alertThreshold;

  const getTimeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <Card className="gradient-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Dynamic DNS
        </CardTitle>
        <Globe className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-2">
          {isHealthy ? (
            <CheckCircle className="h-4 w-4 text-success" />
          ) : isCritical ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-warning" />
          )}
          <Badge
            variant="outline"
            className={
              isHealthy
                ? "bg-success/20 text-success border-success/30"
                : isCritical
                ? "bg-destructive/20 text-destructive border-destructive/30"
                : "bg-warning/20 text-warning border-warning/30"
            }
          >
            {isHealthy ? "Healthy" : isCritical ? "Critical" : "Warning"}
          </Badge>
        </div>
        <div className="text-sm font-mono font-bold text-foreground truncate" title={status.lastIP || undefined}>
          {status.lastIP || "No IP"}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {status.lastUpdate ? getTimeAgo(status.lastUpdate) : "Never updated"}
          {" · "}
          <span className="capitalize">{status.provider}</span>
        </p>
        {status.consecutiveFailures > 0 && (
          <p className="text-xs text-destructive mt-1">
            {status.consecutiveFailures} failure{status.consecutiveFailures > 1 ? "s" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

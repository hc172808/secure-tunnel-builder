import { useState, useEffect, useCallback } from "react";
import {
  Database,
  Globe,
  Shield,
  Server,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ServiceStatus {
  status: "running" | "down";
  latency: number;
  message: string;
  peers?: number;
  uptime?: number;
}

interface ServicesResponse {
  overall: "healthy" | "degraded";
  services: {
    postgresql: ServiceStatus;
    nginx: ServiceStatus;
    wireguard: ServiceStatus;
    api: ServiceStatus;
  };
}

const STORAGE_KEY_SERVER = "wg_manager_server_config";

const SERVICE_META = {
  postgresql: { label: "PostgreSQL", icon: Database, description: "Database engine" },
  nginx: { label: "Nginx", icon: Globe, description: "Reverse proxy" },
  wireguard: { label: "WireGuard", icon: Shield, description: "VPN tunnel" },
  api: { label: "Node API", icon: Server, description: "Backend service" },
} as const;

export function ServiceHealthPanel() {
  const [data, setData] = useState<ServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    const savedConfig = localStorage.getItem(STORAGE_KEY_SERVER);
    if (!savedConfig) {
      setError("No server configured.");
      setLoading(false);
      return;
    }

    try {
      const config = JSON.parse(savedConfig);
      if (!config.apiUrl) {
        setError("No API URL configured.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${config.apiUrl}/services/health`, {
        headers: config.serverToken ? { "x-server-token": config.serverToken } : {},
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error("Endpoint unavailable");
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (error) {
    return (
      <Card className="gradient-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            Internal Services
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchHealth}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading && !data) {
    return (
      <Card className="gradient-border">
        <CardContent className="p-6">
          <div className="h-28 animate-pulse bg-muted rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="gradient-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          Internal Services
          <Badge
            variant="outline"
            className={
              data.overall === "healthy"
                ? "bg-success/20 text-success border-success/30"
                : "bg-warning/20 text-warning border-warning/30"
            }
          >
            {data.overall}
          </Badge>
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={fetchHealth}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.keys(SERVICE_META) as Array<keyof typeof SERVICE_META>).map((key) => {
            const meta = SERVICE_META[key];
            const svc = data.services[key];
            const Icon = meta.icon;
            const isUp = svc?.status === "running";

            return (
              <div
                key={key}
                className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
              >
                <div
                  className={`p-2 rounded-md ${
                    isUp ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{meta.label}</span>
                    {isUp ? (
                      <CheckCircle className="h-3 w-3 text-success" />
                    ) : (
                      <XCircle className="h-3 w-3 text-destructive" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {svc?.message || meta.description}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {svc?.latency > 0 && (
                      <span className="text-xs text-muted-foreground">{svc.latency}ms</span>
                    )}
                    {svc?.uptime !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        ↑ {formatUptime(svc.uptime)}
                      </span>
                    )}
                    {svc?.peers !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        {svc.peers} peer{svc.peers !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import {
  Server,
  Database,
  Wifi,
  Activity,
  Clock,
  Users,
  HardDrive,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { DDNSStatusWidget } from "@/components/DDNSStatusWidget";

interface HealthMetrics {
  database: {
    status: "healthy" | "degraded" | "down";
    latency: number;
    connections: number;
  };
  realtime: {
    status: "connected" | "disconnected";
    channels: number;
  };
  peers: {
    total: number;
    connected: number;
    disconnected: number;
  };
  uptime: {
    startTime: Date;
    duration: string;
  };
  localServer: {
    status: "connected" | "disconnected" | "not_configured";
    latency?: number;
  };
}

const STORAGE_KEY_SERVER = "wg_manager_server_config";

export function SystemHealthDashboard() {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sessionStart] = useState<Date>(new Date());

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    setLoading(true);

    // Check database health
    const dbStart = performance.now();
    const { data: peers, error: dbError } = await supabase
      .from("wireguard_peers")
      .select("id, status");
    const dbLatency = Math.round(performance.now() - dbStart);

    // Check realtime
    let realtimeStatus: "connected" | "disconnected" = "disconnected";
    const channel = supabase.channel("health-check");
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        realtimeStatus = status === "SUBSCRIBED" ? "connected" : "disconnected";
        resolve();
      });
      setTimeout(resolve, 3000);
    });
    supabase.removeChannel(channel);

    // Calculate peer stats
    const total = peers?.length || 0;
    const connected = peers?.filter((p) => p.status === "connected").length || 0;
    const disconnected = total - connected;

    // Check local server
    let localServerStatus: "connected" | "disconnected" | "not_configured" = "not_configured";
    let localServerLatency: number | undefined;

    const savedConfig = localStorage.getItem(STORAGE_KEY_SERVER);
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        if (config.apiUrl) {
          const serverStart = performance.now();
          try {
            const response = await fetch(`${config.apiUrl}/health`, {
              method: "GET",
              headers: config.serverToken ? { "x-server-token": config.serverToken } : {},
              signal: AbortSignal.timeout(5000),
            });
            localServerLatency = Math.round(performance.now() - serverStart);
            localServerStatus = response.ok ? "connected" : "disconnected";
          } catch {
            localServerStatus = "disconnected";
          }
        }
      } catch {
        localServerStatus = "not_configured";
      }
    }

    // Calculate uptime
    const uptimeDuration = formatUptime(new Date().getTime() - sessionStart.getTime());

    setMetrics({
      database: {
        status: dbError ? "down" : dbLatency > 1000 ? "degraded" : "healthy",
        latency: dbLatency,
        connections: 1,
      },
      realtime: {
        status: realtimeStatus,
        channels: 1,
      },
      peers: {
        total,
        connected,
        disconnected,
      },
      uptime: {
        startTime: sessionStart,
        duration: uptimeDuration,
      },
      localServer: {
        status: localServerStatus,
        latency: localServerLatency,
      },
    });

    setLastUpdated(new Date());
    setLoading(false);
  };

  const formatUptime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
      case "connected":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "degraded":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "down":
      case "disconnected":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
      case "connected":
        return "bg-success/20 text-success border-success/30";
      case "degraded":
        return "bg-warning/20 text-warning border-warning/30";
      case "down":
      case "disconnected":
        return "bg-destructive/20 text-destructive border-destructive/30";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  if (loading && !metrics) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="gradient-border">
            <CardContent className="p-6">
              <div className="h-24 animate-pulse bg-muted rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">System Health</h2>
          <p className="text-sm text-muted-foreground">
            Real-time monitoring of system components
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchMetrics} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Database Status */}
        <Card className="gradient-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Database
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              {getStatusIcon(metrics?.database.status || "down")}
              <Badge
                variant="outline"
                className={getStatusColor(metrics?.database.status || "down")}
              >
                {metrics?.database.status || "Unknown"}
              </Badge>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {metrics?.database.latency}ms
            </div>
            <p className="text-xs text-muted-foreground">Response latency</p>
          </CardContent>
        </Card>

        {/* Realtime Status */}
        <Card className="gradient-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Realtime
            </CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              {getStatusIcon(metrics?.realtime.status || "disconnected")}
              <Badge
                variant="outline"
                className={getStatusColor(metrics?.realtime.status || "disconnected")}
              >
                {metrics?.realtime.status || "Unknown"}
              </Badge>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {metrics?.realtime.channels || 0}
            </div>
            <p className="text-xs text-muted-foreground">Active channels</p>
          </CardContent>
        </Card>

        {/* Peers Status */}
        <Card className="gradient-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Peers
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs text-success">{metrics?.peers.connected || 0}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {metrics?.peers.disconnected || 0}
                </span>
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {metrics?.peers.total || 0}
            </div>
            <Progress
              value={
                metrics?.peers.total
                  ? (metrics.peers.connected / metrics.peers.total) * 100
                  : 0
              }
              className="h-1 mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">Total peers</p>
          </CardContent>
        </Card>

        {/* Session Uptime */}
        <Card className="gradient-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Session
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-success animate-pulse" />
              <Badge variant="outline" className="bg-success/20 text-success border-success/30">
                Active
              </Badge>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {metrics?.uptime.duration || "0s"}
            </div>
            <p className="text-xs text-muted-foreground">Session duration</p>
          </CardContent>
        </Card>
      </div>

      {/* DDNS Status Widget */}
      <DDNSStatusWidget />

      {/* Local Server Status */}
      <Card className="gradient-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Local WireGuard Server
          </CardTitle>
          <Server className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(metrics?.localServer.status || "not_configured")}
              <div>
                <Badge
                  variant="outline"
                  className={getStatusColor(metrics?.localServer.status || "not_configured")}
                >
                  {metrics?.localServer.status === "not_configured"
                    ? "Not Configured"
                    : metrics?.localServer.status || "Unknown"}
                </Badge>
                {metrics?.localServer.latency && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Latency: {metrics.localServer.latency}ms
                  </p>
                )}
              </div>
            </div>
            {metrics?.localServer.status === "not_configured" && (
              <p className="text-xs text-muted-foreground">
                Configure server in Settings → Server
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import {
  Container,
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Network,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface ContainerInfo {
  name: string;
  status: "running" | "stopped" | "restarting" | "unknown";
  uptime: string;
  cpu: number;
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
  restarts: number;
  image: string;
  healthCheck: "healthy" | "unhealthy" | "none";
}

const STORAGE_KEY_SERVER = "wg_manager_server_config";

export function DockerHealthPanel() {
  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDockerHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    const savedConfig = localStorage.getItem(STORAGE_KEY_SERVER);
    if (!savedConfig) {
      setError("No server configured. Set up your server connection in Settings → Server.");
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

      const response = await fetch(`${config.apiUrl}/docker/stats`, {
        method: "GET",
        headers: config.serverToken ? { "x-server-token": config.serverToken } : {},
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        // Fallback: try the health endpoint for basic info
        const healthRes = await fetch(`${config.apiUrl}/health`, {
          method: "GET",
          headers: config.serverToken ? { "x-server-token": config.serverToken } : {},
          signal: AbortSignal.timeout(5000),
        });

        if (healthRes.ok) {
          const health = await healthRes.json();
          setContainer({
            name: "wireguard-manager",
            status: "running",
            uptime: health.uptime || "Unknown",
            cpu: 0,
            memory: { used: 0, total: 0, percent: 0 },
            disk: { used: 0, total: 0, percent: 0 },
            network: { rx: 0, tx: 0 },
            restarts: 0,
            image: "wireguard-manager:latest",
            healthCheck: health.status === "healthy" ? "healthy" : "unhealthy",
          });
        } else {
          throw new Error("Server unreachable");
        }

        setLastUpdated(new Date());
        setLoading(false);
        return;
      }

      const data = await response.json();
      setContainer(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Docker stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDockerHealth();
    const interval = setInterval(fetchDockerHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchDockerHealth]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
      case "healthy":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "restarting":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "stopped":
      case "unhealthy":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
      case "healthy":
        return "bg-success/20 text-success border-success/30";
      case "restarting":
        return "bg-warning/20 text-warning border-warning/30";
      case "stopped":
      case "unhealthy":
        return "bg-destructive/20 text-destructive border-destructive/30";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  if (error) {
    return (
      <Card className="gradient-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Container className="h-4 w-4 text-muted-foreground" />
            Docker Container
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchDockerHealth}>
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

  if (loading && !container) {
    return (
      <Card className="gradient-border">
        <CardContent className="p-6">
          <div className="h-32 animate-pulse bg-muted rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!container) return null;

  return (
    <Card className="gradient-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Container className="h-4 w-4 text-muted-foreground" />
          Docker Container
        </CardTitle>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={fetchDockerHealth}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(container.status)}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium font-mono">{container.name}</span>
                <Badge variant="outline" className={getStatusColor(container.status)}>
                  {container.status}
                </Badge>
                {container.healthCheck !== "none" && (
                  <Badge variant="outline" className={getStatusColor(container.healthCheck)}>
                    {container.healthCheck}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {container.image}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-sm">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{container.uptime}</span>
            </div>
            {container.restarts > 0 && (
              <p className="text-xs text-warning mt-0.5">{container.restarts} restarts</p>
            )}
          </div>
        </div>

        {/* Resource Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* CPU */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Cpu className="h-3 w-3" /> CPU
              </span>
              <span className="font-medium">{container.cpu.toFixed(1)}%</span>
            </div>
            <Progress value={container.cpu} className="h-1.5" />
          </div>

          {/* Memory */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <MemoryStick className="h-3 w-3" /> Memory
              </span>
              <span className="font-medium">
                {container.memory.total > 0
                  ? `${formatBytes(container.memory.used)} / ${formatBytes(container.memory.total)}`
                  : `${container.memory.percent.toFixed(1)}%`}
              </span>
            </div>
            <Progress value={container.memory.percent} className="h-1.5" />
          </div>

          {/* Disk */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <HardDrive className="h-3 w-3" /> Disk
              </span>
              <span className="font-medium">
                {container.disk.total > 0
                  ? `${formatBytes(container.disk.used)} / ${formatBytes(container.disk.total)}`
                  : `${container.disk.percent.toFixed(1)}%`}
              </span>
            </div>
            <Progress value={container.disk.percent} className="h-1.5" />
          </div>
        </div>

        {/* Network I/O */}
        {(container.network.rx > 0 || container.network.tx > 0) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
            <Network className="h-3.5 w-3.5" />
            <span>↓ {formatBytes(container.network.rx)}</span>
            <span>↑ {formatBytes(container.network.tx)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Terminal,
  RefreshCw,
  Download,
  Pause,
  Play,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STORAGE_KEY_SERVER = "wg_manager_server_config";

const SERVICES = [
  { value: "wireguard", label: "WireGuard", color: "bg-success/20 text-success" },
  { value: "api", label: "Node API", color: "bg-primary/20 text-primary" },
  { value: "nginx", label: "Nginx Access", color: "bg-accent/20 text-accent-foreground" },
  { value: "nginx-error", label: "Nginx Error", color: "bg-destructive/20 text-destructive" },
  { value: "postgresql", label: "PostgreSQL", color: "bg-warning/20 text-warning" },
  { value: "supervisor", label: "Supervisor", color: "bg-muted text-muted-foreground" },
] as const;

function getServerConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SERVER);
    if (!raw) return null;
    return JSON.parse(raw) as { apiUrl?: string; serverToken?: string };
  } catch {
    return null;
  }
}

export function ContainerLogsViewer() {
  const [service, setService] = useState("wireguard");
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lineCount, setLineCount] = useState("100");
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    const config = getServerConfig();
    if (!config?.apiUrl) {
      setError("No server configured.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${config.apiUrl}/logs/${service}?lines=${lineCount}`,
        {
          headers: config.serverToken ? { "x-server-token": config.serverToken } : {},
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      setLines(data.lines || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
    } finally {
      setLoading(false);
    }
  }, [service, lineCount]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleDownload = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${service}-logs-${new Date().toISOString().split("T")[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentMeta = SERVICES.find((s) => s.value === service);

  return (
    <Card className="gradient-border">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Container Logs
            {currentMeta && (
              <Badge variant="outline" className={currentMeta.color}>
                {currentMeta.label}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={lineCount} onValueChange={setLineCount}>
              <SelectTrigger className="w-[90px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 lines</SelectItem>
                <SelectItem value="100">100 lines</SelectItem>
                <SelectItem value="250">250 lines</SelectItem>
                <SelectItem value="500">500 lines</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
            >
              {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines([])}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownload} disabled={lines.length === 0}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchLogs} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="bg-[hsl(var(--background))] border border-border rounded-lg p-3 h-80 overflow-y-auto font-mono text-xs leading-5"
          >
            {lines.length === 0 ? (
              <span className="text-muted-foreground">No log entries found.</span>
            ) : (
              lines.map((line, i) => (
                <div
                  key={i}
                  className={`hover:bg-muted/30 px-1 rounded ${
                    line.toLowerCase().includes("error") || line.toLowerCase().includes("fail")
                      ? "text-destructive"
                      : line.toLowerCase().includes("warn")
                      ? "text-warning"
                      : "text-foreground/80"
                  }`}
                >
                  <span className="text-muted-foreground select-none mr-2">{String(i + 1).padStart(4)}</span>
                  {line}
                </div>
              ))
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">
            {lines.length} line{lines.length !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-muted-foreground">
            {autoRefresh ? "Auto-refreshing every 5s" : "Paused"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

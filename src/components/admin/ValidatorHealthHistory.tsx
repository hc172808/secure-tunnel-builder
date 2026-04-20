import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, Zap } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface HistoryRow {
  id: string;
  validator_node_id: string;
  status: string;
  latency_ms: number | null;
  block_number: number | null;
  checked_at: string;
}

interface ValidatorOption {
  id: string;
  name: string;
}

const RANGE_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

export function ValidatorHealthHistory() {
  const [validators, setValidators] = useState<ValidatorOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [rangeHours, setRangeHours] = useState<number>(24);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("gyd_validator_nodes").select("id, name").order("priority");
      if (data) {
        setValidators(data);
        if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchHistory();
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, [selectedId, rangeHours]);

  const fetchHistory = async () => {
    setLoading(true);
    const since = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("validator_health_history")
      .select("*")
      .eq("validator_node_id", selectedId)
      .gte("checked_at", since)
      .order("checked_at", { ascending: true });
    if (data) setHistory(data as HistoryRow[]);
    setLoading(false);
  };

  const stats = useMemo(() => {
    if (history.length === 0) return { uptime: 0, avgLatency: 0, p95Latency: 0, total: 0, healthy: 0 };
    const healthy = history.filter(h => h.status === "healthy").length;
    const latencies = history.filter(h => h.latency_ms !== null && h.status === "healthy").map(h => h.latency_ms!).sort((a, b) => a - b);
    const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1] : 0;
    return {
      uptime: (healthy / history.length) * 100,
      avgLatency: Math.round(avg),
      p95Latency: Math.round(p95),
      total: history.length,
      healthy,
    };
  }, [history]);

  const chartData = useMemo(() =>
    history.map(h => ({
      time: new Date(h.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      latency: h.status === "healthy" ? h.latency_ms : null,
      status: h.status,
    })), [history]);

  const uptimeColor = stats.uptime >= 99 ? "text-success" : stats.uptime >= 95 ? "text-warning" : "text-destructive";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Validator Health History
            </CardTitle>
            <CardDescription>Uptime percentage and response latency over time</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select validator" /></SelectTrigger>
              <SelectContent>
                {validators.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(rangeHours)} onValueChange={v => setRangeHours(Number(v))}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map(r => <SelectItem key={r.hours} value={String(r.hours)}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {validators.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Add a validator node to see health history.</p>
        ) : loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No health data in this range yet. Background checks run every 15 minutes.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className={`text-2xl font-bold ${uptimeColor}`}>{stats.uptime.toFixed(2)}%</p>
              </div>
              <div className="p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Avg Latency</p>
                <p className="text-2xl font-bold text-foreground">{stats.avgLatency}ms</p>
              </div>
              <div className="p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">P95 Latency</p>
                <p className="text-2xl font-bold text-foreground">{stats.p95Latency}ms</p>
              </div>
              <div className="p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Checks</p>
                <p className="text-2xl font-bold text-foreground">{stats.healthy}/{stats.total}</p>
              </div>
            </div>

            <div className="h-[280px]">
              <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-1">
                <Zap className="h-4 w-4" /> Response Latency (ms)
              </p>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="latency"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    name="Latency (ms)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-2">Recent Checks</p>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {[...history].reverse().slice(0, 20).map(h => (
                  <div key={h.id} className="flex items-center justify-between p-2 rounded text-xs border border-border">
                    <div className="flex items-center gap-2">
                      <Badge variant={h.status === "healthy" ? "default" : "destructive"} className="text-[10px]">
                        {h.status}
                      </Badge>
                      <span className="text-muted-foreground">{new Date(h.checked_at).toLocaleString()}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {h.latency_ms !== null ? `${h.latency_ms}ms` : "—"}
                      {h.block_number ? ` • #${h.block_number}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

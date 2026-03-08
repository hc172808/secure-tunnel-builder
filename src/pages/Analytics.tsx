import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, Download, ArrowUpDown, Clock, TrendingUp, RefreshCw, Zap, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface Peer {
  id: string;
  name: string;
  status: string;
  transfer_rx: number;
  transfer_tx: number;
  last_handshake: string | null;
}

interface TrafficRecord {
  peer_id: string;
  rx_bytes: number;
  tx_bytes: number;
  recorded_at: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const CHART_COLORS = [
  "hsl(186, 100%, 50%)",
  "hsl(142, 76%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 70%, 55%)",
  "hsl(0, 72%, 51%)",
  "hsl(210, 80%, 55%)",
  "hsl(160, 60%, 50%)",
  "hsl(330, 70%, 55%)",
];

const PIE_COLORS = [
  "hsl(186, 100%, 50%)",
  "hsl(142, 76%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 70%, 55%)",
  "hsl(0, 72%, 51%)",
  "hsl(210, 80%, 55%)",
];

export default function Analytics() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [trafficData, setTrafficData] = useState<TrafficRecord[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("24h");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user, timeRange]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [peersRes, trafficRes] = await Promise.all([
        supabase.from("wireguard_peers").select("id, name, status, transfer_rx, transfer_tx, last_handshake"),
        fetchTrafficStats(),
      ]);
      if (peersRes.data) setPeers(peersRes.data);
      if (trafficRes) setTrafficData(trafficRes);
    } catch (e) {
      console.error("Failed to fetch analytics data", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchTrafficStats = async (): Promise<TrafficRecord[]> => {
    const hoursMap: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };
    const hours = hoursMap[timeRange] || 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const { data } = await supabase
      .from("traffic_stats")
      .select("peer_id, rx_bytes, tx_bytes, recorded_at")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true });

    return data || [];
  };

  // Build time-series data grouped by time bucket
  const timeSeriesData = useMemo(() => {
    const filtered = selectedPeer === "all"
      ? trafficData
      : trafficData.filter((r) => r.peer_id === selectedPeer);

    const bucketCount = 24;
    const hoursMap: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };
    const totalHours = hoursMap[timeRange] || 24;
    const bucketMs = (totalHours * 3600_000) / bucketCount;
    const now = Date.now();
    const start = now - totalHours * 3600_000;

    const buckets: { time: string; rx: number; tx: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = start + i * bucketMs;
      const bucketEnd = bucketStart + bucketMs;
      const label = totalHours <= 24
        ? new Date(bucketEnd).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        : new Date(bucketEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

      const inBucket = filtered.filter((r) => {
        const t = new Date(r.recorded_at).getTime();
        return t >= bucketStart && t < bucketEnd;
      });

      buckets.push({
        time: label,
        rx: inBucket.reduce((s, r) => s + r.rx_bytes, 0),
        tx: inBucket.reduce((s, r) => s + r.tx_bytes, 0),
      });
    }
    return buckets;
  }, [trafficData, selectedPeer, timeRange]);

  // Per-peer total usage for bar chart & pie chart
  const perPeerUsage = useMemo(() => {
    const map = new Map<string, { name: string; rx: number; tx: number }>();
    peers.forEach((p) => map.set(p.id, { name: p.name, rx: 0, tx: 0 }));

    trafficData.forEach((r) => {
      const entry = map.get(r.peer_id);
      if (entry) {
        entry.rx += r.rx_bytes;
        entry.tx += r.tx_bytes;
      }
    });

    // Also include current transfer totals from peers if no traffic_stats
    if (trafficData.length === 0) {
      peers.forEach((p) => {
        const entry = map.get(p.id);
        if (entry) {
          entry.rx = p.transfer_rx || 0;
          entry.tx = p.transfer_tx || 0;
        }
      });
    }

    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v, total: v.rx + v.tx }))
      .filter((v) => v.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [peers, trafficData]);

  const totalRx = useMemo(() => perPeerUsage.reduce((s, p) => s + p.rx, 0), [perPeerUsage]);
  const totalTx = useMemo(() => perPeerUsage.reduce((s, p) => s + p.tx, 0), [perPeerUsage]);

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold font-mono tracking-tight">Traffic Analytics</h1>
          </div>

          <div className="flex items-center gap-3">
            <Select value={selectedPeer} onValueChange={setSelectedPeer}>
              <SelectTrigger className="w-[180px] bg-secondary border-border">
                <SelectValue placeholder="All peers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Peers</SelectItem>
                {peers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[120px] bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 Hour</SelectItem>
                <SelectItem value="6h">6 Hours</SelectItem>
                <SelectItem value="24h">24 Hours</SelectItem>
                <SelectItem value="7d">7 Days</SelectItem>
                <SelectItem value="30d">30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Download</p>
                <p className="text-lg font-bold font-mono">{loading ? "..." : formatBytes(totalRx)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <ArrowUpDown className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Upload</p>
                <p className="text-lg font-bold font-mono">{loading ? "..." : formatBytes(totalTx)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <TrendingUp className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Combined</p>
                <p className="text-lg font-bold font-mono">{loading ? "..." : formatBytes(totalRx + totalTx)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Clock className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Peers</p>
                <p className="text-lg font-bold font-mono">
                  {loading ? "..." : peers.filter((p) => p.status === "connected").length}/{peers.length}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <Tabs defaultValue="timeline" className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="per-peer">Per Peer</TabsTrigger>
            <TabsTrigger value="distribution">Distribution</TabsTrigger>
          </TabsList>

          {/* Timeline Area Chart */}
          <TabsContent value="timeline">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Bandwidth Over Time ({selectedPeer === "all" ? "All Peers" : peers.find((p) => p.id === selectedPeer)?.name})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-[350px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={timeSeriesData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="aRx" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(142, 76%, 45%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(142, 76%, 45%)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="aTx" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(186, 100%, 50%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(186, 100%, 50%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 18%)" vertical={false} />
                      <XAxis dataKey="time" stroke="hsl(215, 20%, 55%)" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(215, 20%, 55%)" fontSize={10} tickFormatter={formatBytes} tickLine={false} axisLine={false} width={65} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(222, 47%, 8%)",
                          border: "1px solid hsl(222, 30%, 18%)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "hsl(210, 40%, 96%)" }}
                        formatter={(value: number, name: string) => [formatBytes(value), name === "rx" ? "↓ Download" : "↑ Upload"]}
                      />
                      <Legend formatter={(value) => (value === "rx" ? "Download" : "Upload")} />
                      <Area type="monotone" dataKey="rx" stroke="hsl(142, 76%, 45%)" strokeWidth={2} fill="url(#aRx)" />
                      <Area type="monotone" dataKey="tx" stroke="hsl(186, 100%, 50%)" strokeWidth={2} fill="url(#aTx)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Per-Peer Bar Chart */}
          <TabsContent value="per-peer">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Bandwidth by Peer</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-[350px] w-full" />
                ) : perPeerUsage.length === 0 ? (
                  <div className="h-[350px] flex items-center justify-center text-muted-foreground text-sm">
                    No traffic data available for this time range
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={perPeerUsage} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 18%)" vertical={false} />
                      <XAxis dataKey="name" stroke="hsl(215, 20%, 55%)" fontSize={10} tickLine={false} axisLine={false} angle={-30} textAnchor="end" />
                      <YAxis stroke="hsl(215, 20%, 55%)" fontSize={10} tickFormatter={formatBytes} tickLine={false} axisLine={false} width={65} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(222, 47%, 8%)",
                          border: "1px solid hsl(222, 30%, 18%)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value: number, name: string) => [formatBytes(value), name === "rx" ? "↓ Download" : "↑ Upload"]}
                      />
                      <Legend formatter={(value) => (value === "rx" ? "Download" : "Upload")} />
                      <Bar dataKey="rx" fill="hsl(142, 76%, 45%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="tx" fill="hsl(186, 100%, 50%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Distribution Pie Chart */}
          <TabsContent value="distribution">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Download Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-[300px] w-full" />
                  ) : perPeerUsage.length === 0 ? (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={perPeerUsage.map((p) => ({ name: p.name, value: p.rx }))}
                          cx="50%" cy="50%" outerRadius={100} innerRadius={50}
                          dataKey="value" paddingAngle={2}
                          label={({ name, value }) => `${name}: ${formatBytes(value)}`}
                        >
                          {perPeerUsage.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatBytes(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Upload Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-[300px] w-full" />
                  ) : perPeerUsage.length === 0 ? (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={perPeerUsage.map((p) => ({ name: p.name, value: p.tx }))}
                          cx="50%" cy="50%" outerRadius={100} innerRadius={50}
                          dataKey="value" paddingAngle={2}
                          label={({ name, value }) => `${name}: ${formatBytes(value)}`}
                        >
                          {perPeerUsage.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatBytes(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Peer Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Peer Bandwidth Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-3 px-2 font-medium">Peer</th>
                      <th className="text-right py-3 px-2 font-medium">Status</th>
                      <th className="text-right py-3 px-2 font-medium">Download</th>
                      <th className="text-right py-3 px-2 font-medium">Upload</th>
                      <th className="text-right py-3 px-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peers.map((peer) => {
                      const usage = perPeerUsage.find((u) => u.id === peer.id);
                      return (
                        <tr key={peer.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                          <td className="py-3 px-2 font-mono font-medium">{peer.name}</td>
                          <td className="py-3 px-2 text-right">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                              peer.status === "connected"
                                ? "bg-success/10 text-success"
                                : "bg-muted text-muted-foreground"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${peer.status === "connected" ? "bg-success" : "bg-muted-foreground"}`} />
                              {peer.status}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-xs">{formatBytes(usage?.rx ?? peer.transfer_rx ?? 0)}</td>
                          <td className="py-3 px-2 text-right font-mono text-xs">{formatBytes(usage?.tx ?? peer.transfer_tx ?? 0)}</td>
                          <td className="py-3 px-2 text-right font-mono text-xs font-bold">
                            {formatBytes((usage?.rx ?? peer.transfer_rx ?? 0) + (usage?.tx ?? peer.transfer_tx ?? 0))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

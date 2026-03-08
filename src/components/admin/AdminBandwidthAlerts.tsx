import { useState, useEffect } from "react";
import { AlertTriangle, Plus, Trash2, Bell, BellOff, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Peer {
  id: string;
  name: string;
}

interface BandwidthAlert {
  id: string;
  peer_id: string;
  threshold_bytes: number;
  period_hours: number;
  enabled: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

interface AlertLog {
  id: string;
  peer_name: string;
  threshold_bytes: number;
  actual_bytes: number;
  period_hours: number;
  created_at: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const bytesFromGB = (gb: number) => gb * 1024 * 1024 * 1024;
const gbFromBytes = (bytes: number) => +(bytes / (1024 * 1024 * 1024)).toFixed(2);

export function AdminBandwidthAlerts() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [alerts, setAlerts] = useState<BandwidthAlert[]>([]);
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogs, setShowLogs] = useState(false);

  // New alert form
  const [newPeerId, setNewPeerId] = useState("");
  const [newThresholdGB, setNewThresholdGB] = useState("1");
  const [newPeriodHours, setNewPeriodHours] = useState("24");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [peersRes, alertsRes, logsRes] = await Promise.all([
      supabase.from("wireguard_peers").select("id, name").order("name"),
      supabase.from("bandwidth_alerts").select("*").order("created_at", { ascending: false }),
      supabase.from("bandwidth_alert_logs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (peersRes.data) setPeers(peersRes.data);
    if (alertsRes.data) setAlerts(alertsRes.data as BandwidthAlert[]);
    if (logsRes.data) setLogs(logsRes.data as AlertLog[]);
    setLoading(false);
  };

  const addAlert = async () => {
    if (!newPeerId) {
      toast.error("Select a peer");
      return;
    }
    const thresholdGB = parseFloat(newThresholdGB);
    if (isNaN(thresholdGB) || thresholdGB <= 0) {
      toast.error("Enter a valid threshold");
      return;
    }

    const { error } = await supabase.from("bandwidth_alerts").insert({
      peer_id: newPeerId,
      threshold_bytes: bytesFromGB(thresholdGB),
      period_hours: parseInt(newPeriodHours) || 24,
      enabled: true,
    });

    if (error) {
      toast.error("Failed to create alert");
      return;
    }
    toast.success("Bandwidth alert created");
    setNewPeerId("");
    setNewThresholdGB("1");
    fetchData();
  };

  const toggleAlert = async (id: string, enabled: boolean) => {
    await supabase.from("bandwidth_alerts").update({ enabled }).eq("id", id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
  };

  const deleteAlert = async (id: string) => {
    await supabase.from("bandwidth_alerts").delete().eq("id", id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    toast.success("Alert deleted");
  };

  const runCheck = async () => {
    try {
      const { error } = await supabase.functions.invoke("check-bandwidth-alerts");
      if (error) throw error;
      toast.success("Bandwidth check completed");
      fetchData();
    } catch {
      toast.error("Failed to run bandwidth check");
    }
  };

  const getPeerName = (peerId: string) => peers.find((p) => p.id === peerId)?.name || "Unknown";

  if (loading) {
    return <div className="animate-pulse text-muted-foreground p-4">Loading alerts...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Create Alert */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Create Bandwidth Alert
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Peer</Label>
              <Select value={newPeerId} onValueChange={setNewPeerId}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder="Select peer" />
                </SelectTrigger>
                <SelectContent>
                  {peers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Threshold (GB)</Label>
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={newThresholdGB}
                onChange={(e) => setNewThresholdGB(e.target.value)}
                className="bg-secondary border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Period</Label>
              <Select value={newPeriodHours} onValueChange={setNewPeriodHours}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 Hour</SelectItem>
                  <SelectItem value="6">6 Hours</SelectItem>
                  <SelectItem value="24">24 Hours</SelectItem>
                  <SelectItem value="168">7 Days</SelectItem>
                  <SelectItem value="720">30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={addAlert} className="w-full gap-2">
                <Plus className="h-4 w-4" /> Add Alert
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Alerts */}
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Active Alerts ({alerts.length})</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={runCheck} className="gap-1">
              <Bell className="h-3 w-3" /> Check Now
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowLogs(!showLogs)} className="gap-1">
              <History className="h-3 w-3" /> {showLogs ? "Hide" : "Show"} Logs
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No bandwidth alerts configured</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border"
                >
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={alert.enabled}
                      onCheckedChange={(checked) => toggleAlert(alert.id, checked)}
                    />
                    <div>
                      <p className="text-sm font-medium font-mono">{getPeerName(alert.peer_id)}</p>
                      <p className="text-xs text-muted-foreground">
                        Alert when &gt; {gbFromBytes(alert.threshold_bytes)} GB in {alert.period_hours}h
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {alert.last_triggered_at && (
                      <Badge variant="destructive" className="text-xs">
                        Triggered {new Date(alert.last_triggered_at).toLocaleDateString()}
                      </Badge>
                    )}
                    {!alert.enabled && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <BellOff className="h-3 w-3" /> Disabled
                      </Badge>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteAlert(alert.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alert History */}
      {showLogs && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Alert History</CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No alerts have been triggered yet</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20"
                  >
                    <div>
                      <p className="text-sm font-medium font-mono">{log.peer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(log.actual_bytes)} / {formatBytes(log.threshold_bytes)} threshold ({log.period_hours}h window)
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

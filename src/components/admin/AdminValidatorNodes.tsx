import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, RefreshCw, Server, Activity, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface ValidatorNode {
  id: string;
  name: string;
  node_type: string;
  endpoint_url: string;
  api_key: string | null;
  is_active: boolean;
  last_health_check: string | null;
  health_status: string;
  priority: number;
  created_at: string;
}

interface ValidationLog {
  id: string;
  payment_id: string;
  validator_node_id: string | null;
  validation_status: string;
  tx_hash: string | null;
  block_number: number | null;
  confirmations: number;
  validated_at: string | null;
  created_at: string;
}

export function AdminValidatorNodes() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<ValidatorNode[]>([]);
  const [logs, setLogs] = useState<ValidationLog[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newNode, setNewNode] = useState({
    name: "",
    node_type: "lite",
    endpoint_url: "",
    api_key: "",
    priority: "1",
  });

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    const [nodesRes, logsRes] = await Promise.all([
      supabase.from("gyd_validator_nodes").select("*").order("priority", { ascending: true }),
      supabase.from("payment_validation_logs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (nodesRes.data) setNodes(nodesRes.data as ValidatorNode[]);
    if (logsRes.data) setLogs(logsRes.data as ValidationLog[]);
  };

  const handleCreate = async () => {
    if (!newNode.name || !newNode.endpoint_url) {
      toast.error("Name and endpoint URL required");
      return;
    }
    const { error } = await supabase.from("gyd_validator_nodes").insert({
      name: newNode.name,
      node_type: newNode.node_type,
      endpoint_url: newNode.endpoint_url,
      api_key: newNode.api_key || null,
      priority: parseInt(newNode.priority) || 1,
      created_by: user?.id,
    } as any);
    if (error) { toast.error("Failed to add validator"); return; }
    toast.success("Validator node added");
    setCreateOpen(false);
    setNewNode({ name: "", node_type: "lite", endpoint_url: "", api_key: "", priority: "1" });
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("gyd_validator_nodes").delete().eq("id", id);
    toast.success("Validator removed");
    fetchAll();
  };

  const handleToggle = async (node: ValidatorNode) => {
    await supabase.from("gyd_validator_nodes").update({ is_active: !node.is_active } as any).eq("id", node.id);
    toast.success(node.is_active ? "Node disabled" : "Node enabled");
    fetchAll();
  };

  const handleHealthCheck = async (node: ValidatorNode) => {
    try {
      const response = await fetch(node.endpoint_url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      const status = response?.ok ? "healthy" : "unhealthy";
      await supabase.from("gyd_validator_nodes").update({
        health_status: status,
        last_health_check: new Date().toISOString(),
      } as any).eq("id", node.id);
      toast.success(`Health: ${status}`);
      fetchAll();
    } catch {
      await supabase.from("gyd_validator_nodes").update({
        health_status: "unhealthy",
        last_health_check: new Date().toISOString(),
      } as any).eq("id", node.id);
      toast.error("Node unreachable");
      fetchAll();
    }
  };

  const healthColor = (status: string) => {
    switch (status) {
      case "healthy": return "default";
      case "unhealthy": return "destructive";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      {/* Validator Nodes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> GYD Validator Nodes
            </CardTitle>
            <CardDescription>
              Add lite or fullnode validators to verify GYD payment transactions
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Node</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Validator Node</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Node Name</Label>
                  <Input value={newNode.name} onChange={e => setNewNode({ ...newNode, name: e.target.value })} placeholder="e.g. Main Fullnode" />
                </div>
                <div>
                  <Label>Node Type</Label>
                  <Select value={newNode.node_type} onValueChange={v => setNewNode({ ...newNode, node_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lite">Lite Node</SelectItem>
                      <SelectItem value="fullnode">Full Node</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {newNode.node_type === "lite"
                      ? "Light client — verifies tx via headers, faster but less secure"
                      : "Full node — validates entire blockchain, most secure"}
                  </p>
                </div>
                <div>
                  <Label>RPC Endpoint URL</Label>
                  <Input value={newNode.endpoint_url} onChange={e => setNewNode({ ...newNode, endpoint_url: e.target.value })} placeholder="https://rpc.gyd.network:8545" />
                </div>
                <div>
                  <Label>API Key (optional)</Label>
                  <Input value={newNode.api_key} onChange={e => setNewNode({ ...newNode, api_key: e.target.value })} placeholder="Bearer token or API key" type="password" />
                </div>
                <div>
                  <Label>Priority (1 = highest)</Label>
                  <Input type="number" min={1} value={newNode.priority} onChange={e => setNewNode({ ...newNode, priority: e.target.value })} />
                </div>
                <Button onClick={handleCreate} className="w-full">Add Validator Node</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {nodes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No validator nodes configured</p>
          ) : (
            <div className="space-y-2">
              {nodes.map(node => (
                <div key={node.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <Server className={`h-5 w-5 ${node.is_active ? "text-primary" : "text-muted-foreground"}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{node.name}</p>
                        <Badge variant="outline" className="text-xs">{node.node_type}</Badge>
                        <Badge variant={healthColor(node.health_status) as any} className="text-xs">{node.health_status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-[250px]">{node.endpoint_url}</p>
                      <p className="text-xs text-muted-foreground">
                        Priority: {node.priority}
                        {node.last_health_check && ` • Last check: ${new Date(node.last_health_check).toLocaleString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => handleHealthCheck(node)} title="Health check">
                      <Activity className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleToggle(node)}>
                      {node.is_active ? <span className="text-success text-xs font-bold">ON</span> : <span className="text-muted-foreground text-xs font-bold">OFF</span>}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(node.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> Payment Validation Logs
          </CardTitle>
          <CardDescription>Recent GYD transaction verification results</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No validation logs yet</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {logs.map(log => (
                <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={log.validation_status === "confirmed" ? "default" : log.validation_status === "failed" ? "destructive" : "secondary"}>
                        {log.validation_status}
                      </Badge>
                      {log.confirmations > 0 && (
                        <span className="text-xs text-muted-foreground">{log.confirmations} confirmations</span>
                      )}
                    </div>
                    {log.tx_hash && <p className="text-xs font-mono text-muted-foreground truncate max-w-[250px] mt-1">{log.tx_hash}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

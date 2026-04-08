import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, BarChart3, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RateTier {
  id: string;
  name: string;
  min_gb: number;
  max_gb: number | null;
  rate_per_gb: number;
  currency: string;
  is_active: boolean;
}

interface BillingRecord {
  id: string;
  user_id: string;
  peer_id: string | null;
  billing_period_start: string;
  billing_period_end: string;
  total_bytes: number;
  total_gb: number;
  amount_due: number;
  currency: string;
  status: string;
  created_at: string;
}

export function AdminUsageBilling() {
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTier, setNewTier] = useState({ name: "", min_gb: "0", max_gb: "", rate_per_gb: "0" });

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    const [tiersRes, recordsRes] = await Promise.all([
      supabase.from("bandwidth_rate_tiers").select("*").order("min_gb", { ascending: true }),
      supabase.from("usage_billing_records").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (tiersRes.data) setTiers(tiersRes.data.map(t => ({ ...t, min_gb: Number(t.min_gb), max_gb: t.max_gb ? Number(t.max_gb) : null, rate_per_gb: Number(t.rate_per_gb) })) as RateTier[]);
    if (recordsRes.data) setRecords(recordsRes.data.map(r => ({ ...r, total_gb: Number((r as any).total_gb), amount_due: Number((r as any).amount_due) })) as BillingRecord[]);
  };

  const handleCreate = async () => {
    if (!newTier.name) { toast.error("Name required"); return; }
    const { error } = await supabase.from("bandwidth_rate_tiers").insert({
      name: newTier.name,
      min_gb: parseFloat(newTier.min_gb) || 0,
      max_gb: newTier.max_gb ? parseFloat(newTier.max_gb) : null,
      rate_per_gb: parseFloat(newTier.rate_per_gb) || 0,
    } as any);
    if (error) { toast.error("Failed to create tier"); return; }
    toast.success("Rate tier created");
    setCreateOpen(false);
    setNewTier({ name: "", min_gb: "0", max_gb: "", rate_per_gb: "0" });
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("bandwidth_rate_tiers").delete().eq("id", id);
    toast.success("Tier deleted");
    fetchAll();
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="space-y-6">
      {/* Rate Tiers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" /> Bandwidth Rate Tiers
            </CardTitle>
            <CardDescription>
              Configure tiered pricing based on actual bandwidth consumed (usage-based billing)
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Tier</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Rate Tier</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Tier Name</Label><Input value={newTier.name} onChange={e => setNewTier({ ...newTier, name: e.target.value })} placeholder="e.g. Basic (0-10 GB)" /></div>
                <div><Label>Min GB</Label><Input type="number" value={newTier.min_gb} onChange={e => setNewTier({ ...newTier, min_gb: e.target.value })} /></div>
                <div><Label>Max GB (empty = unlimited)</Label><Input type="number" value={newTier.max_gb} onChange={e => setNewTier({ ...newTier, max_gb: e.target.value })} /></div>
                <div><Label>Rate per GB (GYD)</Label><Input type="number" step="0.01" value={newTier.rate_per_gb} onChange={e => setNewTier({ ...newTier, rate_per_gb: e.target.value })} /></div>
                <Button onClick={handleCreate} className="w-full">Create Tier</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No rate tiers configured. Add tiers to enable usage-based billing.</p>
          ) : (
            <div className="space-y-2">
              {tiers.map(tier => (
                <div key={tier.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium text-foreground">{tier.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {tier.min_gb} GB – {tier.max_gb ? `${tier.max_gb} GB` : "∞"} • {tier.rate_per_gb} GYD/GB
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(tier.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing Records */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Usage Billing Records
          </CardTitle>
          <CardDescription>Per-user bandwidth consumption and charges</CardDescription>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No billing records yet. Records are created automatically when traffic is collected.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {records.map(record => (
                <div key={record.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm text-foreground">
                      {formatBytes(record.total_bytes)} ({record.total_gb?.toFixed(2)} GB) • {record.amount_due} GYD
                    </p>
                    <p className="text-xs text-muted-foreground">
                      User: {record.user_id.slice(0, 8)}... •{" "}
                      {new Date(record.billing_period_start).toLocaleDateString()} – {new Date(record.billing_period_end).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={record.status === "paid" ? "default" : record.status === "pending" ? "secondary" : "destructive"}>
                    {record.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

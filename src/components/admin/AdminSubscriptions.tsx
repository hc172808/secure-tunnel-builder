import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, X, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_per_peer: number;
  currency: string;
  max_peers: number | null;
  features: string[];
  is_active: boolean;
}

interface Payment {
  id: string;
  user_id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  wallet_address: string;
  tx_hash: string | null;
  status: string;
  created_at: string;
}

interface Subscription {
  id: string;
  user_id: string;
  plan_id: string | null;
  peer_count: number;
  total_amount: number;
  status: string;
  created_at: string;
}

export function AdminSubscriptions() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [newPlan, setNewPlan] = useState({ name: "", description: "", price_per_peer: "0", max_peers: "", features: "", duration_hours: "720", speed_limit_mbps: "", billing_type: "per_peer" });
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    const [plansRes, paymentsRes, subsRes, walletRes] = await Promise.all([
      supabase.from("subscription_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("crypto_payments").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("user_subscriptions").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("server_settings").select("setting_value").eq("setting_key", "gyd_wallet_address").maybeSingle(),
    ]);

    if (plansRes.data) setPlans(plansRes.data.map(p => ({ ...p, price_per_peer: Number(p.price_per_peer), features: (p.features as string[]) || [] })));
    if (paymentsRes.data) setPayments(paymentsRes.data.map(p => ({ ...p, amount: Number(p.amount) })));
    if (subsRes.data) setSubscriptions(subsRes.data.map(s => ({ ...s, total_amount: Number(s.total_amount) })));
    if (walletRes.data?.setting_value) setWalletAddress(walletRes.data.setting_value);
  };

  const handleCreatePlan = async () => {
    const features = newPlan.features.split(",").map(f => f.trim()).filter(Boolean);
    const { error } = await supabase.from("subscription_plans").insert({
      name: newPlan.name,
      description: newPlan.description || null,
      price_per_peer: parseFloat(newPlan.price_per_peer),
      max_peers: newPlan.max_peers ? parseInt(newPlan.max_peers) : null,
      features,
      duration_hours: newPlan.duration_hours ? parseInt(newPlan.duration_hours) : 720,
      speed_limit_mbps: newPlan.speed_limit_mbps ? parseInt(newPlan.speed_limit_mbps) : null,
      billing_type: newPlan.billing_type,
    } as any);
    if (error) { toast.error("Failed to create plan"); return; }
    toast.success("Plan created");
    setCreateOpen(false);
    setNewPlan({ name: "", description: "", price_per_peer: "0", max_peers: "", features: "", duration_hours: "720", speed_limit_mbps: "", billing_type: "per_peer" });
    fetchAll();
  };

  const handleDeletePlan = async (id: string) => {
    await supabase.from("subscription_plans").delete().eq("id", id);
    toast.success("Plan deleted");
    fetchAll();
  };

  const handleConfirmPayment = async (payment: Payment) => {
    // Update payment status
    await supabase.from("crypto_payments").update({ status: "confirmed", confirmed_by: user?.id, confirmed_at: new Date().toISOString() }).eq("id", payment.id);
    // Activate subscription
    await supabase.from("user_subscriptions").update({ status: "active" }).eq("id", payment.subscription_id);
    toast.success("Payment confirmed, subscription activated");
    fetchAll();
  };

  const handleRejectPayment = async (payment: Payment) => {
    await supabase.from("crypto_payments").update({ status: "rejected", confirmed_by: user?.id }).eq("id", payment.id);
    await supabase.from("user_subscriptions").update({ status: "rejected" }).eq("id", payment.subscription_id);
    toast.success("Payment rejected");
    fetchAll();
  };

  const handleSaveWallet = async () => {
    const { data: existing } = await supabase.from("server_settings").select("id").eq("setting_key", "gyd_wallet_address").maybeSingle();
    if (existing) {
      await supabase.from("server_settings").update({ setting_value: walletAddress, updated_by: user?.id }).eq("setting_key", "gyd_wallet_address");
    } else {
      await supabase.from("server_settings").insert({ setting_key: "gyd_wallet_address", setting_value: walletAddress, updated_by: user?.id, description: "GYD cryptocurrency wallet address for payments" });
    }
    toast.success("Wallet address saved");
  };

  const handleCreateSubscription = async (userId: string, planId: string, peerCount: number) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;
    const { error } = await supabase.from("user_subscriptions").insert({
      user_id: userId,
      plan_id: planId,
      peer_count: peerCount,
      total_amount: plan.price_per_peer * peerCount,
      status: "active",
    });
    if (error) { toast.error("Failed"); return; }
    toast.success("Subscription created");
    fetchAll();
  };

  return (
    <div className="space-y-6">
      {/* Wallet Config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> GYD Wallet Address</CardTitle>
          <CardDescription>Set the wallet address where users send GYD coin payments</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="Enter GYD wallet address" className="flex-1" />
          <Button onClick={handleSaveWallet}>Save</Button>
        </CardContent>
      </Card>

      {/* Plans */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Subscription Plans</CardTitle>
            <CardDescription>Manage pay-per-peer plans</CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> New Plan</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Plan</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={newPlan.name} onChange={e => setNewPlan({ ...newPlan, name: e.target.value })} /></div>
                <div><Label>Description</Label><Textarea value={newPlan.description} onChange={e => setNewPlan({ ...newPlan, description: e.target.value })} /></div>
                <div><Label>Price per Peer (GYD)</Label><Input type="number" value={newPlan.price_per_peer} onChange={e => setNewPlan({ ...newPlan, price_per_peer: e.target.value })} /></div>
                <div><Label>Max Peers (optional)</Label><Input type="number" value={newPlan.max_peers} onChange={e => setNewPlan({ ...newPlan, max_peers: e.target.value })} /></div>
                <div><Label>Features (comma-separated)</Label><Input value={newPlan.features} onChange={e => setNewPlan({ ...newPlan, features: e.target.value })} placeholder="VPN access, Priority support" /></div>
                <div><Label>Duration (hours)</Label><Input type="number" value={newPlan.duration_hours} onChange={e => setNewPlan({ ...newPlan, duration_hours: e.target.value })} placeholder="720 = 30 days" /></div>
                <div><Label>Speed Limit (Mbps, empty = unlimited)</Label><Input type="number" value={newPlan.speed_limit_mbps} onChange={e => setNewPlan({ ...newPlan, speed_limit_mbps: e.target.value })} placeholder="e.g. 10, 50, 100" /></div>
                <div>
                  <Label>Billing Type</Label>
                  <Select value={newPlan.billing_type} onValueChange={v => setNewPlan({ ...newPlan, billing_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_peer">Per Peer (flat rate)</SelectItem>
                      <SelectItem value="usage_based">Usage Based (per GB consumed)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreatePlan} className="w-full">Create Plan</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No plans yet</p>
          ) : (
            <div className="space-y-2">
              {plans.map(plan => (
                <div key={plan.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium text-foreground">{plan.name}</p>
                    <p className="text-sm text-muted-foreground">{plan.price_per_peer} GYD/peer{plan.max_peers ? ` • Max ${plan.max_peers}` : ""} • {(plan as any).duration_hours || 720}h{(plan as any).speed_limit_mbps ? ` • ${(plan as any).speed_limit_mbps} Mbps` : " • Unlimited"} • {(plan as any).billing_type === "usage_based" ? "Usage-based" : "Per-peer"}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDeletePlan(plan.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Payments */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Payments</CardTitle>
          <CardDescription>Confirm or reject GYD coin payments</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.filter(p => p.status === "pending").length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No pending payments</p>
          ) : (
            <div className="space-y-2">
              {payments.filter(p => p.status === "pending").map(payment => (
                <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-mono text-sm text-foreground">{payment.amount} GYD</p>
                    <p className="text-xs text-muted-foreground">{new Date(payment.created_at).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">User: {payment.user_id.slice(0, 8)}...</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" onClick={() => handleConfirmPayment(payment)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleRejectPayment(payment)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Subscriptions */}
      <Card>
        <CardHeader>
          <CardTitle>All Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No subscriptions</p>
          ) : (
            <div className="space-y-2">
              {subscriptions.map(sub => (
                <div key={sub.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm text-foreground">{sub.peer_count} peer(s) • {sub.total_amount} GYD</p>
                    <p className="text-xs text-muted-foreground">User: {sub.user_id.slice(0, 8)}... • {new Date(sub.created_at).toLocaleDateString()}</p>
                  </div>
                  <Badge variant={sub.status === "active" ? "default" : "secondary"}>{sub.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

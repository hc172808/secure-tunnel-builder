import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, ChevronLeft, CreditCard, QrCode, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import QRCode from "qrcode";

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

interface Subscription {
  id: string;
  plan_id: string | null;
  peer_count: number;
  total_amount: number;
  status: string;
  expires_at: string | null;
  created_at: string;
}

// Default wallet - admin can configure via server_settings
const DEFAULT_WALLET = "GYD_WALLET_ADDRESS_HERE";

export default function Subscriptions() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [walletAddress, setWalletAddress] = useState(DEFAULT_WALLET);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [peerCount, setPeerCount] = useState(1);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [pendingPayment, setPendingPayment] = useState<{ subscriptionId: string; amount: number } | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      fetchPlans();
      fetchSubscriptions();
      fetchWalletAddress();
    }
  }, [user]);

  const fetchPlans = async () => {
    const { data } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("price_per_peer", { ascending: true });
    if (data) setPlans(data.map(p => ({ ...p, price_per_peer: Number(p.price_per_peer), features: (p.features as string[]) || [] })));
  };

  const fetchSubscriptions = async () => {
    const { data } = await supabase
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });
    if (data) setSubscriptions(data.map(s => ({ ...s, total_amount: Number(s.total_amount) })));
  };

  const fetchWalletAddress = async () => {
    const { data } = await supabase
      .from("server_settings")
      .select("setting_value")
      .eq("setting_key", "gyd_wallet_address")
      .maybeSingle();
    if (data?.setting_value) setWalletAddress(data.setting_value);
  };

  const handleSubscribe = async (plan: Plan) => {
    setSelectedPlan(plan);
    setPeerCount(1);
    setPaymentDialog(true);
  };

  const generatePaymentQR = async () => {
    if (!selectedPlan || !user) return;

    const amount = selectedPlan.price_per_peer * peerCount;

    // Create subscription
    const { data: sub, error: subError } = await supabase
      .from("user_subscriptions")
      .insert({
        user_id: user.id,
        plan_id: selectedPlan.id,
        peer_count: peerCount,
        total_amount: amount,
        status: "pending",
      })
      .select()
      .single();

    if (subError) {
      toast.error("Failed to create subscription");
      return;
    }

    // Create payment record
    const { error: payError } = await supabase
      .from("crypto_payments")
      .insert({
        user_id: user.id,
        subscription_id: sub.id,
        amount,
        currency: "GYD",
        wallet_address: walletAddress,
      });

    if (payError) {
      toast.error("Failed to create payment");
      return;
    }

    // Generate QR code with wallet address and amount
    const paymentData = `gyd:${walletAddress}?amount=${amount}&ref=${sub.id}`;
    const qr = await QRCode.toDataURL(paymentData, { width: 300, margin: 2 });
    setQrDataUrl(qr);
    setPendingPayment({ subscriptionId: sub.id, amount });
    toast.success("Payment QR generated! Scan to pay.");
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "pending": return "secondary";
      case "expired": return "destructive";
      default: return "outline";
    }
  };

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">Subscriptions</h1>
              <p className="text-xs text-muted-foreground">Pay-per-peer with GYD coins</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Plans */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Available Plans</h2>
          {plans.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No plans available yet. Contact admin.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <Card key={plan.id} className="relative overflow-hidden">
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary mb-2">
                      {plan.price_per_peer} <span className="text-sm font-normal text-muted-foreground">GYD/peer</span>
                    </div>
                    {plan.max_peers && (
                      <p className="text-sm text-muted-foreground mb-3">Max {plan.max_peers} peers</p>
                    )}
                    <ul className="space-y-1">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                          <Check className="h-3 w-3 text-success" /> {f}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={() => handleSubscribe(plan)} className="w-full">
                      <CreditCard className="mr-2 h-4 w-4" /> Subscribe
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* My Subscriptions */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">My Subscriptions</h2>
          {subscriptions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No subscriptions yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <Card key={sub.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{sub.peer_count} peer(s)</p>
                      <p className="text-sm text-muted-foreground">{sub.total_amount} GYD • {new Date(sub.created_at).toLocaleDateString()}</p>
                    </div>
                    <Badge variant={statusColor(sub.status) as any}>{sub.status}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Payment Dialog */}
      <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay with GYD Coins</DialogTitle>
            <DialogDescription>
              {selectedPlan ? `${selectedPlan.name} - ${selectedPlan.price_per_peer} GYD per peer` : ""}
            </DialogDescription>
          </DialogHeader>

          {!pendingPayment ? (
            <div className="space-y-4">
              <div>
                <Label>Number of Peers</Label>
                <Input
                  type="number"
                  min={1}
                  max={selectedPlan?.max_peers || 100}
                  value={peerCount}
                  onChange={(e) => setPeerCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold text-foreground">
                  {((selectedPlan?.price_per_peer || 0) * peerCount).toFixed(2)} GYD
                </p>
              </div>
              <Button onClick={generatePaymentQR} className="w-full">
                <QrCode className="mr-2 h-4 w-4" /> Generate Payment QR
              </Button>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              {qrDataUrl && (
                <img src={qrDataUrl} alt="Payment QR" className="mx-auto rounded-lg border border-border" />
              )}
              <div className="p-3 rounded-lg bg-muted text-left">
                <p className="text-xs text-muted-foreground mb-1">Send exactly</p>
                <p className="font-bold text-foreground">{pendingPayment.amount} GYD</p>
                <p className="text-xs text-muted-foreground mt-2 mb-1">To wallet</p>
                <code className="text-xs break-all text-foreground">{walletAddress}</code>
              </div>
              <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                <Clock className="h-4 w-4" /> Awaiting admin confirmation
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setPendingPayment(null);
                  setQrDataUrl("");
                  setPaymentDialog(false);
                  fetchSubscriptions();
                }}
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Wifi, Shield, Zap, Check, CreditCard, QrCode, LogIn, UserPlus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import QRCode from "qrcode";
import { PortalStatus } from "@/components/hotspot/PortalStatus";

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_per_peer: number;
  currency: string;
  max_peers: number | null;
  duration_hours: number | null;
  speed_limit_mbps: number | null;
  features: string[];
  is_active: boolean;
}

export default function Hotspot() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [user, setUser] = useState<any>(null);
  const [authTab, setAuthTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");

  // Payment state
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [peerCount, setPeerCount] = useState(1);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [pendingPayment, setPendingPayment] = useState<{ subscriptionId: string; amount: number } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    fetchPlans();
    fetchWallet();
    return () => subscription.unsubscribe();
  }, []);

  const fetchPlans = async () => {
    const { data } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("price_per_peer", { ascending: true });
    if (data) setPlans(data.map(p => ({
      ...p,
      price_per_peer: Number(p.price_per_peer),
      duration_hours: (p as any).duration_hours ?? null,
      speed_limit_mbps: (p as any).speed_limit_mbps ?? null,
      features: (p.features as string[]) || [],
    })));
  };

  const fetchWallet = async () => {
    const { data } = await supabase
      .from("server_settings")
      .select("setting_value")
      .eq("setting_key", "gyd_wallet_address")
      .maybeSingle();
    if (data?.setting_value) setWalletAddress(data.setting_value);
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    else toast.success("Logged in!");
    setAuthLoading(false);
  };

  const handleSignup = async () => {
    setAuthLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    });
    if (error) toast.error(error.message);
    else toast.success("Account created! Check your email to verify.");
    setAuthLoading(false);
  };

  const handleBuyPlan = (plan: Plan) => {
    if (!user) {
      toast.error("Please log in first");
      return;
    }
    setSelectedPlan(plan);
    setPeerCount(1);
    setPendingPayment(null);
    setQrDataUrl("");
    setPaymentDialog(true);
  };

  const generatePaymentQR = async () => {
    if (!selectedPlan || !user) return;
    const amount = selectedPlan.price_per_peer * peerCount;
    const durationHours = (selectedPlan as any).duration_hours || 720;
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();

    const { data: sub, error: subError } = await supabase
      .from("user_subscriptions")
      .insert({
        user_id: user.id,
        plan_id: selectedPlan.id,
        peer_count: peerCount,
        total_amount: amount,
        status: "pending",
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (subError) { toast.error("Failed to create subscription"); return; }

    await supabase.from("crypto_payments").insert({
      user_id: user.id,
      subscription_id: sub.id,
      amount,
      currency: "GYD",
      wallet_address: walletAddress,
    });

    const paymentData = `gyd:${walletAddress}?amount=${amount}&ref=${sub.id}`;
    const qr = await QRCode.toDataURL(paymentData, { width: 300, margin: 2 });
    setQrDataUrl(qr);
    setPendingPayment({ subscriptionId: sub.id, amount });
    toast.success("Scan QR to pay with GYD coins");
  };

  const formatDuration = (hours: number | null) => {
    if (!hours) return "30 days";
    if (hours < 24) return `${hours}h`;
    if (hours < 720) return `${Math.round(hours / 24)}d`;
    return `${Math.round(hours / 720)}mo`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero */}
      <header className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/5" />
        <div className="container mx-auto px-4 py-12 relative z-10 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Wifi className="h-10 w-10 text-primary" />
            <Shield className="h-8 w-8 text-accent" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
            Secure Hotspot Access
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Connect to the internet with WireGuard VPN protection. Choose a plan and start browsing securely.
          </p>
          {!user && (
            <Badge variant="secondary" className="mt-4">
              <Zap className="h-3 w-3 mr-1" /> Limited free trial available
            </Badge>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-1 space-y-8">
        {/* Auth Section */}
        {!user && (
          <Card className="max-w-md mx-auto">
            <CardHeader className="text-center">
              <CardTitle>Get Started</CardTitle>
              <CardDescription>Log in or create an account to purchase a plan</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as "login" | "signup")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login"><LogIn className="mr-1 h-3 w-3" />Login</TabsTrigger>
                  <TabsTrigger value="signup"><UserPlus className="mr-1 h-3 w-3" />Sign Up</TabsTrigger>
                </TabsList>
                <TabsContent value="login" className="space-y-3 mt-4">
                  <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
                  <div><Label>Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
                  <Button onClick={handleLogin} disabled={authLoading} className="w-full">
                    {authLoading ? "Logging in..." : "Log In"}
                  </Button>
                </TabsContent>
                <TabsContent value="signup" className="space-y-3 mt-4">
                  <div><Label>Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose a username" /></div>
                  <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
                  <div><Label>Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" /></div>
                  <Button onClick={handleSignup} disabled={authLoading} className="w-full">
                    {authLoading ? "Creating..." : "Create Account"}
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {user && (
          <div className="space-y-6">
            <div className="text-center">
              <Badge variant="outline" className="text-sm">
                Logged in as {user.email}
              </Badge>
              <Button variant="ghost" size="sm" className="ml-2" onClick={() => supabase.auth.signOut()}>
                Sign Out
              </Button>
            </div>
            <div className="max-w-lg mx-auto">
              <PortalStatus userId={user.id} />
            </div>
          </div>
        )}

        {/* Plans */}
        <section>
          <h2 className="text-xl font-semibold text-foreground text-center mb-6">Choose Your Plan</h2>
          {plans.length === 0 ? (
            <Card className="max-w-md mx-auto">
              <CardContent className="p-6 text-center text-muted-foreground">
                No plans available yet. Contact the administrator.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
              {plans.map((plan) => (
                <Card key={plan.id} className="relative overflow-hidden hover:border-primary/50 transition-colors">
                  <CardHeader>
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary mb-1">
                      {plan.price_per_peer} <span className="text-sm font-normal text-muted-foreground">GYD/peer</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                      <Clock className="h-3 w-3" /> {formatDuration(plan.duration_hours)}
                      {plan.max_peers && <span> • Max {plan.max_peers} peers</span>}
                      <span> • {plan.speed_limit_mbps ? `${plan.speed_limit_mbps} Mbps` : "Unlimited"}</span>
                    </div>
                    <ul className="space-y-1">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                          <Check className="h-3 w-3 text-success" /> {f}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={() => handleBuyPlan(plan)} className="w-full">
                      <CreditCard className="mr-2 h-4 w-4" /> Buy Now
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Free trial info */}
        <section className="max-w-2xl mx-auto text-center">
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-6">
              <Zap className="h-8 w-8 text-warning mx-auto mb-2" />
              <h3 className="font-semibold text-foreground mb-1">Free Trial</h3>
              <p className="text-sm text-muted-foreground">
                Connect to the network for limited browsing. Upgrade to a paid plan for full speed, more peers, and VPN protection.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        Powered by WireGuard VPN • Pay with GYD Cryptocurrency
      </footer>

      {/* Payment Dialog */}
      <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay with GYD Coins</DialogTitle>
            <DialogDescription>
              {selectedPlan ? `${selectedPlan.name} — ${selectedPlan.price_per_peer} GYD/peer • ${formatDuration(selectedPlan.duration_hours)}` : ""}
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
                <p className="text-xs text-muted-foreground mt-1">
                  Valid for {formatDuration(selectedPlan?.duration_hours ?? null)}
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

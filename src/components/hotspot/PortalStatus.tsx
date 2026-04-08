import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Wifi, Clock, Gauge, Monitor, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Subscription {
  id: string;
  status: string;
  peer_count: number;
  total_amount: number;
  expires_at: string | null;
  created_at: string;
  auto_renew: boolean;
  plan: {
    name: string;
    speed_limit_mbps: number | null;
    duration_hours: number | null;
    features: string[];
  } | null;
}

interface AssignedPeer {
  id: string;
  peer: {
    id: string;
    name: string;
    status: string;
    allowed_ips: string;
    last_handshake: string | null;
    transfer_rx: number | null;
    transfer_tx: number | null;
  };
}

export function PortalStatus({ userId }: { userId: string }) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [peers, setPeers] = useState<AssignedPeer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, [userId]);

  const fetchStatus = async () => {
    setLoading(true);
    const [subRes, peerRes] = await Promise.all([
      supabase
        .from("user_subscriptions")
        .select("*, subscription_plans(*)")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("peer_assignments")
        .select("id, wireguard_peers(id, name, status, allowed_ips, last_handshake, transfer_rx, transfer_tx)")
        .eq("user_id", userId),
    ]);

    if (subRes.data) {
      const plan = subRes.data.subscription_plans;
      setSubscription({
        ...subRes.data,
        total_amount: Number(subRes.data.total_amount),
        auto_renew: (subRes.data as any).auto_renew ?? false,
        plan: plan
          ? {
              name: plan.name,
              speed_limit_mbps: (plan as any).speed_limit_mbps ?? null,
              duration_hours: plan.duration_hours ?? null,
              features: (plan.features as string[]) || [],
            }
          : null,
      });
    } else {
      setSubscription(null);
    }

    if (peerRes.data) {
      setPeers(
        peerRes.data
          .filter((p: any) => p.wireguard_peers)
          .map((p: any) => ({ id: p.id, peer: p.wireguard_peers }))
      );
    }
    setLoading(false);
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${units[i]}`;
  };

  const getTimeRemaining = () => {
    if (!subscription?.expires_at) return null;
    const diff = new Date(subscription.expires_at).getTime() - Date.now();
    if (diff <= 0) return { text: "Expired", percent: 0, urgent: true };
    const totalMs = subscription.plan?.duration_hours
      ? subscription.plan.duration_hours * 3600000
      : 720 * 3600000;
    const percent = Math.max(0, Math.min(100, (diff / totalMs) * 100));
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return { text: `${days}d ${hours % 24}h remaining`, percent, urgent: false };
    }
    return { text: `${hours}h ${mins}m remaining`, percent, urgent: hours < 2 };
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">Loading status...</CardContent>
      </Card>
    );
  }

  const timeRemaining = subscription ? getTimeRemaining() : null;

  return (
    <div className="space-y-4">
      {/* Subscription Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wifi className="h-5 w-5 text-primary" /> Connection Status
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={fetchStatus}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {subscription ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{subscription.plan?.name || "Custom Plan"}</p>
                  <p className="text-sm text-muted-foreground">{subscription.peer_count} peer(s) allocated</p>
                </div>
                <Badge variant="default" className="bg-green-600">Active</Badge>
              </div>

              {/* Time Remaining */}
              {timeRemaining && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> Time Remaining
                    </span>
                    <span className={timeRemaining.urgent ? "text-destructive font-medium" : "text-foreground"}>
                      {timeRemaining.urgent && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                      {timeRemaining.text}
                    </span>
                  </div>
                  <Progress value={timeRemaining.percent} className="h-2" />
                </div>
              )}

              {/* Auto-Renew Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" /> Auto-Renew
                </span>
                <button
                  onClick={async () => {
                    const newVal = !subscription.auto_renew;
                    await supabase.from("user_subscriptions").update({ auto_renew: newVal } as any).eq("id", subscription.id);
                    setSubscription({ ...subscription, auto_renew: newVal });
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    subscription.auto_renew
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {subscription.auto_renew ? "On" : "Off"}
                </button>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Gauge className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">
                  Speed: {subscription.plan?.speed_limit_mbps
                    ? `${subscription.plan.speed_limit_mbps} Mbps`
                    : "Unlimited"}
                </span>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
              <p className="font-medium text-foreground">No Active Subscription</p>
              <p className="text-sm text-muted-foreground mt-1">
                You're on the free trial with limited speed. Purchase a plan for full access.
              </p>
              <div className="flex items-center gap-2 justify-center mt-3 p-3 rounded-lg bg-muted/50">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Speed: 1 Mbps (Free Trial)</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected Devices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" /> Connected Devices
          </CardTitle>
          <CardDescription>
            {peers.length === 0 ? "No devices connected" : `${peers.length} device(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {peers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No WireGuard peers assigned to your account yet.
            </p>
          ) : (
            <div className="space-y-2">
              {peers.map(({ peer }) => (
                <div key={peer.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${peer.status === "connected" ? "bg-green-500" : "bg-muted-foreground"}`} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{peer.name}</p>
                      <p className="text-xs text-muted-foreground">{peer.allowed_ips}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>↓ {formatBytes(peer.transfer_rx)}</p>
                    <p>↑ {formatBytes(peer.transfer_tx)}</p>
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

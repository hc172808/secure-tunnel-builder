import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Users, ArrowUpDown, Activity, RefreshCw, LogOut, Settings, QrCode, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { PeerCard } from "@/components/PeerCard";
import { AddPeerDialog } from "@/components/AddPeerDialog";
import { ConfigViewer } from "@/components/ConfigViewer";
import { QRCodeViewer } from "@/components/QRCodeViewer";
import { ServerStatus } from "@/components/ServerStatus";
import { TrafficChart } from "@/components/TrafficChart";
import { DownloadApps } from "@/components/DownloadApps";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Sample data for demo - in production this comes from database
const samplePeers = [
  {
    id: "1",
    name: "MacBook Pro",
    publicKey: "xTIBA5rboUvnH4htodjb60Y7YAf21J7YQMlNGC8HQ14=",
    allowedIPs: "10.0.0.2/32",
    endpoint: "192.168.1.100:51820",
    lastHandshake: "2 minutes ago",
    transferRx: "1.2 GB",
    transferTx: "856 MB",
    status: "connected" as const,
  },
  {
    id: "2",
    name: "iPhone 15",
    publicKey: "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=",
    allowedIPs: "10.0.0.3/32",
    endpoint: "192.168.1.101:51820",
    lastHandshake: "5 minutes ago",
    transferRx: "456 MB",
    transferTx: "234 MB",
    status: "connected" as const,
  },
  {
    id: "3",
    name: "Home Server",
    publicKey: "pVYWqT8c7wH9P5X3Q0M2kJNLzRoGsYuFbKdE1iAhVn4=",
    allowedIPs: "10.0.0.4/32",
    lastHandshake: "Never",
    status: "pending" as const,
  },
];

const generateConfig = (peerName: string, allowedIPs: string) => `[Interface]
PrivateKey = <YOUR_PRIVATE_KEY>
Address = ${allowedIPs}
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = sWoS+tBxn5gJ0E+RYhI6L1M2vX4dFnP8qT7zKaJmHk0=
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = vpn.example.com:51820
PersistentKeepalive = 25`;

export default function Index() {
  const navigate = useNavigate();
  const { user, loading, isAdmin, profile, signOut } = useAuth();
  const [peers, setPeers] = useState(samplePeers);
  const [showTrafficChart, setShowTrafficChart] = useState(false);
  const [configViewer, setConfigViewer] = useState<{
    open: boolean;
    peerName: string;
    config: string;
  }>({ open: false, peerName: "", config: "" });
  const [qrViewer, setQrViewer] = useState<{
    open: boolean;
    peerName: string;
    config: string;
  }>({ open: false, peerName: "", config: "" });

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const connectedPeers = peers.filter((p) => p.status === "connected").length;
  const totalTransfer = "2.74 GB";

  const handleAddPeer = async (newPeer: { name: string; allowedIPs: string }) => {
    const peer = {
      id: Date.now().toString(),
      name: newPeer.name,
      publicKey: btoa(Math.random().toString()).slice(0, 44) + "=",
      allowedIPs: newPeer.allowedIPs + "/32",
      lastHandshake: undefined,
      status: "pending" as const,
    };
    setPeers([...peers, peer]);
    
    // Log action
    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action: "CREATE",
      resource_type: "peer",
      details: { name: newPeer.name },
    });
    
    toast.success("Peer added successfully");
  };

  const handleDeletePeer = async (id: string) => {
    setPeers(peers.filter((p) => p.id !== id));
    
    // Log action
    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action: "DELETE",
      resource_type: "peer",
      resource_id: id,
    });
    
    toast.success("Peer deleted successfully");
  };

  const handleViewConfig = (id: string) => {
    const peer = peers.find((p) => p.id === id);
    if (peer) {
      setConfigViewer({
        open: true,
        peerName: peer.name,
        config: generateConfig(peer.name, peer.allowedIPs),
      });
    }
  };

  const handleViewQR = (id: string) => {
    const peer = peers.find((p) => p.id === id);
    if (peer) {
      setQrViewer({
        open: true,
        peerName: peer.name,
        config: generateConfig(peer.name, peer.allowedIPs),
      });
    }
  };

  const handleRefresh = () => {
    toast.success("Refreshing peer status...");
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-primary">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Shield className="h-8 w-8 text-primary" />
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-success animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">WireGuard VPN</h1>
                <p className="text-xs text-muted-foreground">Management Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden md:block">
                {profile?.display_name || user.email}
              </span>
              <DownloadApps 
                peerConfig={configViewer.config} 
                peerName={configViewer.peerName} 
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowTrafficChart(!showTrafficChart)}
                title="Toggle Traffic Chart"
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              {isAdmin && (
                <Button variant="outline" size="icon" onClick={() => navigate("/admin")}>
                  <Settings className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
              </Button>
              {isAdmin && <AddPeerDialog onAddPeer={handleAddPeer} />}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8 animate-fade-in">
          <StatCard
            title="Total Peers"
            value={peers.length}
            subtitle={`${connectedPeers} connected`}
            icon={Users}
            trend="up"
          />
          <StatCard
            title="Active Connections"
            value={connectedPeers}
            subtitle="Real-time"
            icon={Activity}
          />
          <StatCard
            title="Total Transfer"
            value={totalTransfer}
            subtitle="Last 24 hours"
            icon={ArrowUpDown}
            trend="up"
          />
          <StatCard
            title="Server Status"
            value="Online"
            subtitle="99.9% uptime"
            icon={Shield}
          />
        </div>

        {/* Traffic Chart */}
        {showTrafficChart && (
          <div className="mb-8 gradient-border rounded-xl p-5 animate-fade-in">
            <h2 className="text-lg font-semibold text-foreground mb-4">Bandwidth Usage (24h)</h2>
            <TrafficChart />
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Server Status Panel */}
          <div className="lg:col-span-1 animate-slide-in">
            <ServerStatus
              isRunning={true}
              publicKey="sWoS+tBxn5gJ0E+RYhI6L1M2vX4dFnP8qT7zKaJmHk0="
              endpoint="vpn.example.com"
              listenPort={51820}
              uptime="14 days, 6 hours"
            />
          </div>

          {/* Peers List */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Peers</h2>
              <p className="text-sm text-muted-foreground">
                {peers.length} total · {connectedPeers} online
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {peers.map((peer, index) => (
                <div
                  key={peer.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <PeerCard
                    peer={peer}
                    onDelete={isAdmin ? handleDeletePeer : undefined}
                    onViewConfig={handleViewConfig}
                    onViewQR={handleViewQR}
                    isAdmin={isAdmin}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Config Viewer Dialog */}
      <ConfigViewer
        open={configViewer.open}
        onClose={() => setConfigViewer({ ...configViewer, open: false })}
        peerName={configViewer.peerName}
        config={configViewer.config}
        onViewQR={() => {
          setConfigViewer({ ...configViewer, open: false });
          setQrViewer({
            open: true,
            peerName: configViewer.peerName,
            config: configViewer.config,
          });
        }}
      />

      {/* QR Code Viewer Dialog */}
      <QRCodeViewer
        open={qrViewer.open}
        onClose={() => setQrViewer({ ...qrViewer, open: false })}
        peerName={qrViewer.peerName}
        config={qrViewer.config}
      />
    </div>
  );
}

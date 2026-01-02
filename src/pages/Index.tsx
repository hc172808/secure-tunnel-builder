import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Users, ArrowUpDown, Activity, RefreshCw, LogOut, Settings, BarChart3 } from "lucide-react";
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

interface WireGuardPeer {
  id: string;
  name: string;
  public_key: string;
  private_key?: string;
  allowed_ips: string;
  endpoint?: string;
  dns: string;
  status: "connected" | "disconnected" | "pending";
  last_handshake?: string;
  transfer_rx: number;
  transfer_tx: number;
  created_at: string;
}

interface ServerSettings {
  is_running: boolean;
  public_key: string;
  endpoint: string;
  listen_port: number;
  uptime: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const generateConfig = (peer: WireGuardPeer, serverPublicKey: string, serverEndpoint: string) => `[Interface]
PrivateKey = ${peer.private_key || "<YOUR_PRIVATE_KEY>"}
Address = ${peer.allowed_ips}
DNS = ${peer.dns || "1.1.1.1"}

[Peer]
PublicKey = ${serverPublicKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${serverEndpoint}:51820
PersistentKeepalive = 25`;

export default function Index() {
  const navigate = useNavigate();
  const { user, loading, isAdmin, profile, signOut } = useAuth();
  const [peers, setPeers] = useState<WireGuardPeer[]>([]);
  const [serverSettings, setServerSettings] = useState<ServerSettings>({
    is_running: false,
    public_key: "",
    endpoint: "",
    listen_port: 51820,
    uptime: "0d 0h 0m",
  });
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
  const [refreshing, setRefreshing] = useState(false);

  // Fetch peers from database
  const fetchPeers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("wireguard_peers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      if (data) {
        setPeers(data.map((peer) => ({
          id: peer.id,
          name: peer.name,
          public_key: peer.public_key,
          private_key: peer.private_key,
          allowed_ips: peer.allowed_ips || "10.0.0.0/24",
          endpoint: peer.endpoint,
          dns: peer.dns || "1.1.1.1",
          status: (peer.status as "connected" | "disconnected" | "pending") || "disconnected",
          last_handshake: peer.last_handshake,
          transfer_rx: peer.transfer_rx || 0,
          transfer_tx: peer.transfer_tx || 0,
          created_at: peer.created_at,
        })));
      }
    } catch (error) {
      console.error("Error fetching peers:", error);
    }
  }, []);

  // Fetch server settings
  const fetchServerSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("server_settings")
        .select("setting_key, setting_value");

      if (error) throw error;

      if (data) {
        const settings: Partial<ServerSettings> = {};
        data.forEach((row) => {
          if (row.setting_key === "is_running") settings.is_running = row.setting_value === "true";
          if (row.setting_key === "public_key") settings.public_key = row.setting_value;
          if (row.setting_key === "endpoint") settings.endpoint = row.setting_value;
          if (row.setting_key === "listen_port") settings.listen_port = parseInt(row.setting_value) || 51820;
          if (row.setting_key === "uptime") settings.uptime = row.setting_value;
        });
        setServerSettings((prev) => ({ ...prev, ...settings }));
      }
    } catch (error) {
      console.error("Error fetching server settings:", error);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    if (user) {
      fetchPeers();
      fetchServerSettings();
    }
  }, [user, fetchPeers, fetchServerSettings]);

  // Real-time subscription for peer updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("wireguard-peers-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wireguard_peers",
        },
        (payload) => {
          console.log("Peer update received:", payload);
          fetchPeers();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "server_settings",
        },
        (payload) => {
          console.log("Server settings update received:", payload);
          fetchServerSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchPeers, fetchServerSettings]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const connectedPeers = peers.filter((p) => p.status === "connected").length;
  const totalTransferRx = peers.reduce((acc, p) => acc + (p.transfer_rx || 0), 0);
  const totalTransferTx = peers.reduce((acc, p) => acc + (p.transfer_tx || 0), 0);
  const totalTransfer = formatBytes(totalTransferRx + totalTransferTx);

  const handleAddPeer = async (newPeer: { name: string; allowedIPs: string }) => {
    try {
      const { error } = await supabase.from("wireguard_peers").insert({
        name: newPeer.name,
        public_key: btoa(Math.random().toString()).slice(0, 44) + "=",
        allowed_ips: newPeer.allowedIPs + "/32",
        status: "pending",
      });
      
      if (error) throw error;
      
      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "CREATE",
        resource_type: "peer",
        details: { name: newPeer.name },
      });
      
      toast.success("Peer added successfully");
      fetchPeers();
    } catch (error) {
      toast.error("Failed to add peer");
    }
  };

  const handleDeletePeer = async (id: string) => {
    try {
      const { error } = await supabase.from("wireguard_peers").delete().eq("id", id);
      if (error) throw error;
      
      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "DELETE",
        resource_type: "peer",
        resource_id: id,
      });
      
      toast.success("Peer deleted successfully");
      fetchPeers();
    } catch (error) {
      toast.error("Failed to delete peer");
    }
  };

  const handleViewConfig = (id: string) => {
    const peer = peers.find((p) => p.id === id);
    if (peer) {
      setConfigViewer({
        open: true,
        peerName: peer.name,
        config: generateConfig(peer, serverSettings.public_key, serverSettings.endpoint),
      });
    }
  };

  const handleViewQR = (id: string) => {
    const peer = peers.find((p) => p.id === id);
    if (peer) {
      setQrViewer({
        open: true,
        peerName: peer.name,
        config: generateConfig(peer, serverSettings.public_key, serverSettings.endpoint),
      });
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchPeers(), fetchServerSettings()]);
    setRefreshing(false);
    toast.success("Peer status refreshed");
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
                    peer={{
                      id: peer.id,
                      name: peer.name,
                      publicKey: peer.public_key,
                      allowedIPs: peer.allowed_ips,
                      endpoint: peer.endpoint,
                      lastHandshake: peer.last_handshake,
                      transferRx: formatBytes(peer.transfer_rx),
                      transferTx: formatBytes(peer.transfer_tx),
                      status: peer.status,
                    }}
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

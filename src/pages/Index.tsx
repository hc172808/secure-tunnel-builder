import { useState } from "react";
import { Shield, Users, ArrowUpDown, Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { PeerCard } from "@/components/PeerCard";
import { AddPeerDialog } from "@/components/AddPeerDialog";
import { ConfigViewer } from "@/components/ConfigViewer";
import { ServerStatus } from "@/components/ServerStatus";
import { toast } from "sonner";

// Sample data - in real app this would come from API
const initialPeers = [
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
  {
    id: "4",
    name: "Old Laptop",
    publicKey: "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3AbC4=",
    allowedIPs: "10.0.0.5/32",
    lastHandshake: "3 days ago",
    transferRx: "12.4 MB",
    transferTx: "8.1 MB",
    status: "disconnected" as const,
  },
];

const generateConfig = (peerName: string) => `[Interface]
PrivateKey = <YOUR_PRIVATE_KEY>
Address = 10.0.0.2/32
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = sWoS+tBxn5gJ0E+RYhI6L1M2vX4dFnP8qT7zKaJmHk0=
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = vpn.example.com:51820
PersistentKeepalive = 25`;

export default function Index() {
  const [peers, setPeers] = useState(initialPeers);
  const [configViewer, setConfigViewer] = useState<{
    open: boolean;
    peerName: string;
    config: string;
  }>({ open: false, peerName: "", config: "" });

  const connectedPeers = peers.filter((p) => p.status === "connected").length;
  const totalTransfer = "2.74 GB";

const handleAddPeer = (newPeer: { name: string; allowedIPs: string }) => {
    const peer = {
      id: Date.now().toString(),
      name: newPeer.name,
      publicKey: btoa(Math.random().toString()).slice(0, 44) + "=",
      allowedIPs: newPeer.allowedIPs + "/32",
      lastHandshake: undefined,
      status: "pending" as const,
    };
    setPeers([...peers, peer]);
  };

  const handleDeletePeer = (id: string) => {
    setPeers(peers.filter((p) => p.id !== id));
    toast.success("Peer deleted successfully");
  };

  const handleViewConfig = (id: string) => {
    const peer = peers.find((p) => p.id === id);
    if (peer) {
      setConfigViewer({
        open: true,
        peerName: peer.name,
        config: generateConfig(peer.name),
      });
    }
  };

  const handleRefresh = () => {
    toast.success("Refreshing peer status...");
  };

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
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <AddPeerDialog onAddPeer={handleAddPeer} />
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
                    onDelete={handleDeletePeer}
                    onViewConfig={handleViewConfig}
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
      />
    </div>
  );
}

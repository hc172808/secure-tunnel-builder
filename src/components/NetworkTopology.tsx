import { useState, useEffect, useMemo } from "react";
import { Server, Monitor, Smartphone, Laptop, Cloud, Wifi, WifiOff, Globe, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface PeerNode {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "pending";
  allowed_ips: string;
  subdomain: string | null;
  hostname: string | null;
  last_handshake: string | null;
  transfer_rx: number | null;
  transfer_tx: number | null;
  group_id: string | null;
  peer_groups?: {
    name: string;
    color: string;
  } | null;
}

interface ServerInfo {
  endpoint: string;
  public_key: string;
  listen_port: string;
  is_running: string;
}

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const getDeviceIcon = (name: string) => {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("phone") || lowerName.includes("mobile") || lowerName.includes("iphone") || lowerName.includes("android")) {
    return Smartphone;
  }
  if (lowerName.includes("laptop") || lowerName.includes("macbook") || lowerName.includes("notebook")) {
    return Laptop;
  }
  if (lowerName.includes("server") || lowerName.includes("vps") || lowerName.includes("cloud")) {
    return Cloud;
  }
  return Monitor;
};

export function NetworkTopology() {
  const [peers, setPeers] = useState<PeerNode[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [peersRes, settingsRes] = await Promise.all([
        supabase
          .from("wireguard_peers")
          .select(`
            id, name, status, allowed_ips, subdomain, hostname,
            last_handshake, transfer_rx, transfer_tx, group_id,
            peer_groups (name, color)
          `)
          .order("name"),
        supabase
          .from("server_settings")
          .select("setting_key, setting_value")
          .in("setting_key", ["endpoint", "public_key", "listen_port", "is_running"])
      ]);

      if (peersRes.data) {
        setPeers(peersRes.data as unknown as PeerNode[]);
      }

      if (settingsRes.data) {
        const settings: Partial<ServerInfo> = {};
        settingsRes.data.forEach(s => {
          settings[s.setting_key as keyof ServerInfo] = s.setting_value;
        });
        setServerInfo(settings as ServerInfo);
      }
    } catch (error) {
      console.error("Error fetching topology data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Real-time subscription
    const channel = supabase
      .channel("topology-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wireguard_peers" },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const connectedPeers = useMemo(() => peers.filter(p => p.status === "connected"), [peers]);
  const disconnectedPeers = useMemo(() => peers.filter(p => p.status !== "connected"), [peers]);

  // Group peers by their group for visual organization
  const groupedPeers = useMemo(() => {
    const groups: Record<string, PeerNode[]> = { ungrouped: [] };
    peers.forEach(peer => {
      const groupName = peer.peer_groups?.name || "ungrouped";
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(peer);
    });
    return groups;
  }, [peers]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Network Topology
            </CardTitle>
            <CardDescription>
              Visual representation of connected peers and their subdomains
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Central Server Node */}
          <div className="flex flex-col items-center mb-8">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative">
                    <div className={cn(
                      "w-24 h-24 rounded-full flex items-center justify-center border-4",
                      serverInfo?.is_running === "true" 
                        ? "bg-primary/10 border-primary animate-pulse" 
                        : "bg-muted border-muted-foreground"
                    )}>
                      <Server className="h-10 w-10 text-primary" />
                    </div>
                    <div className={cn(
                      "absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center",
                      serverInfo?.is_running === "true" ? "bg-success" : "bg-muted-foreground"
                    )}>
                      {serverInfo?.is_running === "true" ? (
                        <Wifi className="h-3 w-3 text-success-foreground" />
                      ) : (
                        <WifiOff className="h-3 w-3 text-muted" />
                      )}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1">
                    <p className="font-semibold">WireGuard Server</p>
                    <p className="text-xs">Endpoint: {serverInfo?.endpoint || "N/A"}</p>
                    <p className="text-xs">Port: {serverInfo?.listen_port || "51820"}</p>
                    <p className="text-xs">Status: {serverInfo?.is_running === "true" ? "Running" : "Stopped"}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <p className="mt-2 font-semibold">WireGuard Server</p>
            <p className="text-xs text-muted-foreground">{serverInfo?.endpoint || "Not configured"}</p>
          </div>

          {/* Connection Stats */}
          <div className="flex justify-center gap-4 mb-8">
            <Badge variant="default" className="gap-1">
              <Wifi className="h-3 w-3" />
              {connectedPeers.length} Connected
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <WifiOff className="h-3 w-3" />
              {disconnectedPeers.length} Offline
            </Badge>
            <Badge variant="outline" className="gap-1">
              {peers.length} Total Peers
            </Badge>
          </div>

          {/* Connection Lines and Peer Nodes */}
          <div className="relative">
            {/* Visual connection lines from server */}
            <div className="absolute top-0 left-1/2 w-px h-8 bg-border -translate-x-1/2" />
            
            {/* Peer Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pt-8">
              {peers.map((peer) => {
                const DeviceIcon = getDeviceIcon(peer.name);
                const isConnected = peer.status === "connected";
                
                return (
                  <TooltipProvider key={peer.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className={cn(
                          "relative p-4 rounded-lg border-2 transition-all cursor-pointer hover:shadow-md",
                          isConnected 
                            ? "border-success bg-success/5" 
                            : "border-muted bg-muted/30"
                        )}>
                          {/* Connection line to this peer */}
                          <div className={cn(
                            "absolute -top-8 left-1/2 w-px h-8 -translate-x-1/2",
                            isConnected ? "bg-success" : "bg-muted"
                          )} />
                          
                          <div className="flex flex-col items-center text-center">
                            <div className={cn(
                              "w-12 h-12 rounded-full flex items-center justify-center mb-2",
                              isConnected ? "bg-success/20" : "bg-muted"
                            )}>
                              <DeviceIcon className={cn(
                                "h-6 w-6",
                                isConnected ? "text-success" : "text-muted-foreground"
                              )} />
                            </div>
                            
                            <p className="font-medium text-sm truncate w-full">{peer.name}</p>
                            
                            {peer.hostname && (
                              <p className="text-xs text-primary truncate w-full mt-1">
                                {peer.hostname}
                              </p>
                            )}
                            
                            <p className="text-xs text-muted-foreground font-mono mt-1">
                              {peer.allowed_ips.split('/')[0]}
                            </p>
                            
                            <div className="flex items-center gap-1 mt-2">
                              {isConnected ? (
                                <Wifi className="h-3 w-3 text-success" />
                              ) : (
                                <WifiOff className="h-3 w-3 text-muted-foreground" />
                              )}
                              <span className={cn(
                                "text-xs",
                                isConnected ? "text-success" : "text-muted-foreground"
                              )}>
                                {isConnected ? "Online" : "Offline"}
                              </span>
                            </div>
                            
                            {peer.peer_groups && (
                              <Badge 
                                variant="outline" 
                                className="mt-2 text-xs"
                                style={{ borderColor: peer.peer_groups.color, color: peer.peer_groups.color }}
                              >
                                {peer.peer_groups.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        <div className="space-y-2">
                          <p className="font-semibold">{peer.name}</p>
                          <div className="text-xs space-y-1">
                            <p>IP: {peer.allowed_ips}</p>
                            {peer.hostname && <p>Hostname: {peer.hostname}</p>}
                            {peer.subdomain && <p>Subdomain: {peer.subdomain}</p>}
                            <p>Status: {peer.status}</p>
                            {peer.last_handshake && (
                              <p>Last seen: {new Date(peer.last_handshake).toLocaleString()}</p>
                            )}
                            <div className="flex gap-2">
                              <span>↓ {formatBytes(peer.transfer_rx || 0)}</span>
                              <span>↑ {formatBytes(peer.transfer_tx || 0)}</span>
                            </div>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </div>

          {peers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No peers configured yet</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import { Wifi, WifiOff, Loader2, Cloud, Database, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

interface ConnectionState {
  cloud: "connected" | "disconnected" | "checking";
  localServer: "connected" | "disconnected" | "checking" | "not_configured";
  database: "connected" | "disconnected" | "checking";
  realtime: "connected" | "disconnected" | "checking";
}

const STORAGE_KEY_SERVER = "wg_manager_server_config";

export function ConnectionStatusIndicator() {
  const [connections, setConnections] = useState<ConnectionState>({
    cloud: "checking",
    localServer: "not_configured",
    database: "checking",
    realtime: "checking",
  });
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkConnections = async () => {
    setConnections(prev => ({
      ...prev,
      cloud: "checking",
      database: "checking",
      realtime: "checking",
    }));

    // Check Cloud/Supabase connection
    try {
      const { error } = await supabase.from("server_settings").select("id").limit(1);
      setConnections(prev => ({
        ...prev,
        cloud: error ? "disconnected" : "connected",
        database: error ? "disconnected" : "connected",
      }));
    } catch {
      setConnections(prev => ({
        ...prev,
        cloud: "disconnected",
        database: "disconnected",
      }));
    }

    // Check realtime
    const channel = supabase.channel("connection-test");
    channel.subscribe((status) => {
      setConnections(prev => ({
        ...prev,
        realtime: status === "SUBSCRIBED" ? "connected" : "disconnected",
      }));
      supabase.removeChannel(channel);
    });

    // Check local server if configured
    const savedConfig = localStorage.getItem(STORAGE_KEY_SERVER);
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        if (config.apiUrl) {
          setConnections(prev => ({ ...prev, localServer: "checking" }));
          try {
            const response = await fetch(`${config.apiUrl}/health`, {
              method: "GET",
              headers: config.serverToken ? { "x-server-token": config.serverToken } : {},
              signal: AbortSignal.timeout(5000),
            });
            setConnections(prev => ({
              ...prev,
              localServer: response.ok ? "connected" : "disconnected",
            }));
          } catch {
            setConnections(prev => ({ ...prev, localServer: "disconnected" }));
          }
        }
      } catch {
        setConnections(prev => ({ ...prev, localServer: "not_configured" }));
      }
    }

    setLastChecked(new Date());
  };

  useEffect(() => {
    checkConnections();
    
    // Re-check every 30 seconds
    const interval = setInterval(checkConnections, 30000);
    return () => clearInterval(interval);
  }, []);

  const getOverallStatus = () => {
    if (connections.cloud === "checking" || connections.database === "checking") {
      return "checking";
    }
    if (connections.cloud === "connected" && connections.database === "connected") {
      return "connected";
    }
    return "disconnected";
  };

  const overallStatus = getOverallStatus();

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case "connected":
        return <span className="h-2 w-2 rounded-full bg-success animate-pulse" />;
      case "disconnected":
        return <span className="h-2 w-2 rounded-full bg-destructive" />;
      case "checking":
        return <Loader2 className="h-2 w-2 animate-spin text-muted-foreground" />;
      default:
        return <span className="h-2 w-2 rounded-full bg-muted-foreground" />;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent transition-colors">
          {overallStatus === "checking" ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : overallStatus === "connected" ? (
            <Wifi className="h-4 w-4 text-success" />
          ) : (
            <WifiOff className="h-4 w-4 text-destructive" />
          )}
          <span className="text-xs font-medium hidden sm:inline">
            {overallStatus === "checking" ? "Checking..." : overallStatus === "connected" ? "Connected" : "Disconnected"}
          </span>
          <span 
            className={`h-2 w-2 rounded-full ${
              overallStatus === "connected" 
                ? "bg-success animate-pulse" 
                : overallStatus === "checking" 
                  ? "bg-yellow-500 animate-pulse" 
                  : "bg-destructive"
            }`} 
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Connection Status</h4>
            <button 
              onClick={checkConnections} 
              className="text-xs text-primary hover:underline"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Cloud Backend</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon status={connections.cloud} />
                <span className="text-xs text-muted-foreground capitalize">
                  {connections.cloud}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Database</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon status={connections.database} />
                <span className="text-xs text-muted-foreground capitalize">
                  {connections.database}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Realtime</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon status={connections.realtime} />
                <span className="text-xs text-muted-foreground capitalize">
                  {connections.realtime}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Local Server</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon status={connections.localServer} />
                <span className="text-xs text-muted-foreground capitalize">
                  {connections.localServer === "not_configured" ? "Not configured" : connections.localServer}
                </span>
              </div>
            </div>
          </div>

          {lastChecked && (
            <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
              Last checked: {lastChecked.toLocaleTimeString()}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

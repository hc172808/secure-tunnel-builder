import { Shield, Globe, Key, Clock } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

interface ServerStatusProps {
  isRunning: boolean;
  publicKey: string;
  endpoint: string;
  listenPort: number;
  uptime: string;
}

export function ServerStatus({
  isRunning,
  publicKey,
  endpoint,
  listenPort,
  uptime,
}: ServerStatusProps) {
  return (
    <div className="gradient-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Shield className="h-8 w-8 text-primary" />
            {isRunning && (
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-success animate-pulse" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">WireGuard Server</h2>
            <p className="text-sm text-muted-foreground">wg0 interface</p>
          </div>
        </div>
        <StatusBadge status={isRunning ? "connected" : "disconnected"} />
      </div>

      <div className="grid gap-4">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <Globe className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Endpoint</p>
            <p className="text-sm font-mono text-foreground truncate">
              {endpoint}:{listenPort}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <Key className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Public Key</p>
            <p className="text-sm font-mono text-foreground truncate">
              {publicKey}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <Clock className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Uptime</p>
            <p className="text-sm font-mono text-foreground">{uptime}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

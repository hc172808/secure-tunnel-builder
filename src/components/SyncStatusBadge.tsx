import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SyncStatus, getSyncStatus } from "@/lib/syncService";
import { formatDistanceToNow } from "date-fns";

export function SyncStatusBadge() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());

  useEffect(() => {
    // Initial load
    setSyncStatus(getSyncStatus());

    // Listen for sync status changes
    const handleStatusChange = (e: CustomEvent<SyncStatus>) => {
      setSyncStatus(e.detail);
    };

    window.addEventListener("sync-status-changed", handleStatusChange as EventListener);
    
    // Also poll periodically in case events are missed
    const interval = setInterval(() => {
      setSyncStatus(getSyncStatus());
    }, 5000);

    return () => {
      window.removeEventListener("sync-status-changed", handleStatusChange as EventListener);
      clearInterval(interval);
    };
  }, []);

  const getStatusInfo = () => {
    if (syncStatus.isRunning) {
      return {
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        text: "Syncing...",
        variant: "default" as const,
        color: "text-primary",
      };
    }
    if (syncStatus.lastError) {
      return {
        icon: <XCircle className="h-3 w-3" />,
        text: "Sync Error",
        variant: "destructive" as const,
        color: "text-destructive",
      };
    }
    if (syncStatus.lastSync) {
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        text: "Synced",
        variant: "secondary" as const,
        color: "text-success",
      };
    }
    return {
      icon: <Clock className="h-3 w-3" />,
      text: "Not synced",
      variant: "outline" as const,
      color: "text-muted-foreground",
    };
  };

  const status = getStatusInfo();
  const lastSyncTime = syncStatus.lastSync
    ? formatDistanceToNow(new Date(syncStatus.lastSync), { addSuffix: true })
    : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={status.variant}
            className={`gap-1 cursor-default ${status.color}`}
          >
            {status.icon}
            <span className="hidden sm:inline text-xs">{status.text}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <div className="space-y-1">
            <p className="font-medium flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Database Sync
            </p>
            {syncStatus.isRunning && (
              <p className="text-xs">Synchronizing data...</p>
            )}
            {syncStatus.lastSync && !syncStatus.isRunning && (
              <p className="text-xs text-muted-foreground">
                Last sync: {lastSyncTime}
              </p>
            )}
            {syncStatus.lastError && (
              <p className="text-xs text-destructive">{syncStatus.lastError}</p>
            )}
            {!syncStatus.lastSync && !syncStatus.isRunning && !syncStatus.lastError && (
              <p className="text-xs text-muted-foreground">
                No sync performed yet
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

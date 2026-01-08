import { useState, useEffect } from "react";
import { RefreshCw, CloudOff, ArrowRightLeft, ArrowUp, ArrowDown, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SyncConfig, SyncStatus, getSyncStatus, performSync, startAutoSync, stopAutoSync } from "@/lib/syncService";

const STORAGE_KEY_SYNC = "wg_manager_sync_config";

export function SyncManager() {
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({
    enabled: false,
    interval: 60,
    direction: "bidirectional",
    conflictResolution: "newest_wins",
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SYNC);
    if (saved) {
      try {
        setSyncConfig(JSON.parse(saved));
      } catch {}
    }

    const handleStatusChange = (e: CustomEvent<SyncStatus>) => {
      setSyncStatus(e.detail);
    };

    window.addEventListener("sync-status-changed", handleStatusChange as EventListener);
    return () => {
      window.removeEventListener("sync-status-changed", handleStatusChange as EventListener);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SYNC, JSON.stringify(syncConfig));
    if (syncConfig.enabled) {
      startAutoSync(syncConfig);
    } else {
      stopAutoSync();
    }
  }, [syncConfig]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    const result = await performSync(syncConfig);
    setIsSyncing(false);
    
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
    setSyncStatus(getSyncStatus());
  };

  const getDirectionIcon = () => {
    switch (syncConfig.direction) {
      case "cloud_to_local":
        return <ArrowDown className="h-4 w-4" />;
      case "local_to_cloud":
        return <ArrowUp className="h-4 w-4" />;
      default:
        return <ArrowRightLeft className="h-4 w-4" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" />
          Database Sync
        </CardTitle>
        <CardDescription>
          Synchronize data between cloud and local server database
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sync Status */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
          <div className="flex items-center gap-3">
            {syncStatus.isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : syncStatus.lastError ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : syncStatus.lastSync ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <CloudOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium text-sm">
                {syncStatus.isRunning
                  ? "Syncing..."
                  : syncStatus.lastError
                    ? "Sync Error"
                    : syncStatus.lastSync
                      ? "Synced"
                      : "Not synced"}
              </p>
              {syncStatus.lastSync && !syncStatus.isRunning && (
                <p className="text-xs text-muted-foreground">
                  Last: {new Date(syncStatus.lastSync).toLocaleString()}
                </p>
              )}
              {syncStatus.lastError && (
                <p className="text-xs text-destructive">{syncStatus.lastError}</p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSync}
            disabled={isSyncing || syncStatus.isRunning}
            className="gap-2"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync Now
          </Button>
        </div>

        {/* Auto-sync toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Auto-sync</Label>
            <p className="text-sm text-muted-foreground">
              Automatically sync data at regular intervals
            </p>
          </div>
          <Switch
            checked={syncConfig.enabled}
            onCheckedChange={(enabled) => setSyncConfig({ ...syncConfig, enabled })}
          />
        </div>

        {/* Sync interval */}
        {syncConfig.enabled && (
          <div className="space-y-2 animate-fade-in">
            <Label>Sync Interval (seconds)</Label>
            <Input
              type="number"
              min={10}
              max={3600}
              value={syncConfig.interval}
              onChange={(e) => setSyncConfig({ ...syncConfig, interval: parseInt(e.target.value) || 60 })}
            />
            <p className="text-xs text-muted-foreground">
              Minimum 10 seconds, maximum 1 hour
            </p>
          </div>
        )}

        {/* Sync direction */}
        <div className="space-y-2">
          <Label>Sync Direction</Label>
          <Select
            value={syncConfig.direction}
            onValueChange={(value) => setSyncConfig({ ...syncConfig, direction: value as SyncConfig["direction"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bidirectional">
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  Bidirectional
                </span>
              </SelectItem>
              <SelectItem value="cloud_to_local">
                <span className="flex items-center gap-2">
                  <ArrowDown className="h-4 w-4" />
                  Cloud → Local
                </span>
              </SelectItem>
              <SelectItem value="local_to_cloud">
                <span className="flex items-center gap-2">
                  <ArrowUp className="h-4 w-4" />
                  Local → Cloud
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Conflict resolution */}
        <div className="space-y-2">
          <Label>Conflict Resolution</Label>
          <Select
            value={syncConfig.conflictResolution}
            onValueChange={(value) => setSyncConfig({ ...syncConfig, conflictResolution: value as SyncConfig["conflictResolution"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest_wins">Newest wins (by updated_at)</SelectItem>
              <SelectItem value="cloud_wins">Cloud always wins</SelectItem>
              <SelectItem value="local_wins">Local always wins</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            How to handle conflicts when the same record exists on both sides
          </p>
        </div>

        {/* Current direction indicator */}
        <div className="flex items-center gap-2 pt-4 border-t border-border">
          {getDirectionIcon()}
          <span className="text-sm text-muted-foreground">
            {syncConfig.direction === "bidirectional"
              ? "Changes sync both ways"
              : syncConfig.direction === "cloud_to_local"
                ? "Cloud data overwrites local"
                : "Local data overwrites cloud"}
          </span>
          {syncConfig.enabled && (
            <Badge variant="secondary" className="ml-auto">
              Every {syncConfig.interval}s
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import { History, CheckCircle2, XCircle, ArrowRightLeft, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";

const SYNC_HISTORY_KEY = "wg_sync_history";
const MAX_HISTORY_ITEMS = 50;

export interface SyncHistoryEntry {
  id: string;
  timestamp: string;
  success: boolean;
  message: string;
  direction: "cloud_to_local" | "local_to_cloud" | "bidirectional";
  recordsSynced: number;
  duration?: number; // in ms
}

export function addSyncHistoryEntry(entry: Omit<SyncHistoryEntry, "id" | "timestamp">) {
  const history = getSyncHistory();
  const newEntry: SyncHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  
  history.unshift(newEntry);
  
  // Keep only last MAX_HISTORY_ITEMS
  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS);
  }
  
  localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(history));
  window.dispatchEvent(new CustomEvent("sync-history-updated", { detail: history }));
}

export function getSyncHistory(): SyncHistoryEntry[] {
  const saved = localStorage.getItem(SYNC_HISTORY_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {}
  }
  return [];
}

export function clearSyncHistory() {
  localStorage.removeItem(SYNC_HISTORY_KEY);
  window.dispatchEvent(new CustomEvent("sync-history-updated", { detail: [] }));
}

export function SyncHistory() {
  const [history, setHistory] = useState<SyncHistoryEntry[]>(getSyncHistory());

  useEffect(() => {
    const handleUpdate = (e: CustomEvent<SyncHistoryEntry[]>) => {
      setHistory(e.detail);
    };

    window.addEventListener("sync-history-updated", handleUpdate as EventListener);
    return () => {
      window.removeEventListener("sync-history-updated", handleUpdate as EventListener);
    };
  }, []);

  const getDirectionIcon = (direction: SyncHistoryEntry["direction"]) => {
    switch (direction) {
      case "cloud_to_local":
        return <ArrowDown className="h-3 w-3" />;
      case "local_to_cloud":
        return <ArrowUp className="h-3 w-3" />;
      default:
        return <ArrowRightLeft className="h-3 w-3" />;
    }
  };

  const getDirectionLabel = (direction: SyncHistoryEntry["direction"]) => {
    switch (direction) {
      case "cloud_to_local":
        return "Cloud → Local";
      case "local_to_cloud":
        return "Local → Cloud";
      default:
        return "Bidirectional";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5 text-primary" />
            Sync History
          </CardTitle>
          <CardDescription>
            Recent synchronization operations
          </CardDescription>
        </div>
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSyncHistory}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No sync history yet</p>
            <p className="text-xs">Sync operations will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-3">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className={`p-3 rounded-lg border ${
                    entry.success
                      ? "border-success/20 bg-success/5"
                      : "border-destructive/20 bg-destructive/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {entry.success ? (
                        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          {entry.success ? "Sync completed" : "Sync failed"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="gap-1 text-xs">
                      {getDirectionIcon(entry.direction)}
                      {getDirectionLabel(entry.direction)}
                    </Badge>
                  </div>
                  
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      {entry.recordsSynced} record{entry.recordsSynced !== 1 ? "s" : ""} synced
                    </span>
                    {entry.duration && (
                      <span>{entry.duration}ms</span>
                    )}
                  </div>
                  
                  {!entry.success && entry.message && (
                    <p className="mt-2 text-xs text-destructive">{entry.message}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

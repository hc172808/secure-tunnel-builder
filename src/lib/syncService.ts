import { supabase } from "@/integrations/supabase/client";
import { WireGuardPeer } from "./api";

const STORAGE_KEY_SERVER = "wg_manager_server_config";
const SYNC_STATUS_KEY = "wg_sync_status";
const LAST_SYNC_KEY = "wg_last_sync";

export interface SyncStatus {
  isRunning: boolean;
  lastSync: string | null;
  lastError: string | null;
  direction: "cloud_to_local" | "local_to_cloud" | "bidirectional" | null;
  pendingChanges: number;
}

export interface SyncConfig {
  enabled: boolean;
  interval: number; // in seconds
  direction: "cloud_to_local" | "local_to_cloud" | "bidirectional";
  conflictResolution: "cloud_wins" | "local_wins" | "newest_wins";
}

export interface LocalPeer {
  id: string;
  name: string;
  public_key: string;
  private_key?: string;
  allowed_ips: string;
  endpoint?: string;
  dns?: string;
  persistent_keepalive?: number;
  status: string;
  last_handshake?: string;
  transfer_rx?: number;
  transfer_tx?: number;
  created_at: string;
  updated_at: string;
}

interface ServerConfig {
  apiUrl: string;
  serverToken: string;
}

function getServerConfig(): ServerConfig | null {
  const saved = localStorage.getItem(STORAGE_KEY_SERVER);
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

export function getSyncStatus(): SyncStatus {
  const saved = localStorage.getItem(SYNC_STATUS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {}
  }
  return {
    isRunning: false,
    lastSync: null,
    lastError: null,
    direction: null,
    pendingChanges: 0,
  };
}

function updateSyncStatus(updates: Partial<SyncStatus>) {
  const current = getSyncStatus();
  const newStatus = { ...current, ...updates };
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(newStatus));
  window.dispatchEvent(new CustomEvent("sync-status-changed", { detail: newStatus }));
}

async function fetchLocalPeers(config: ServerConfig): Promise<LocalPeer[]> {
  const response = await fetch(`${config.apiUrl}/peers`, {
    headers: {
      "Content-Type": "application/json",
      ...(config.serverToken && { "x-server-token": config.serverToken }),
    },
  });
  if (!response.ok) throw new Error("Failed to fetch local peers");
  return response.json();
}

async function fetchCloudPeers(): Promise<WireGuardPeer[]> {
  const { data, error } = await supabase
    .from("wireguard_peers")
    .select("*");
  if (error) throw error;
  return data || [];
}

async function pushPeerToLocal(config: ServerConfig, peer: WireGuardPeer): Promise<void> {
  const response = await fetch(`${config.apiUrl}/peers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.serverToken && { "x-server-token": config.serverToken }),
    },
    body: JSON.stringify(peer),
  });
  if (!response.ok) throw new Error(`Failed to push peer ${peer.name} to local`);
}

async function updatePeerOnLocal(config: ServerConfig, peer: WireGuardPeer): Promise<void> {
  const response = await fetch(`${config.apiUrl}/peers/${peer.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(config.serverToken && { "x-server-token": config.serverToken }),
    },
    body: JSON.stringify(peer),
  });
  if (!response.ok) throw new Error(`Failed to update peer ${peer.name} on local`);
}

async function pushPeerToCloud(peer: LocalPeer): Promise<void> {
  const { error } = await supabase
    .from("wireguard_peers")
    .upsert({
      id: peer.id,
      name: peer.name,
      public_key: peer.public_key,
      private_key: peer.private_key,
      allowed_ips: peer.allowed_ips,
      endpoint: peer.endpoint,
      dns: peer.dns,
      persistent_keepalive: peer.persistent_keepalive,
      status: peer.status,
      last_handshake: peer.last_handshake,
      transfer_rx: peer.transfer_rx,
      transfer_tx: peer.transfer_tx,
      updated_at: peer.updated_at,
    });
  if (error) throw error;
}

function resolveConflict(
  cloudPeer: WireGuardPeer,
  localPeer: LocalPeer,
  resolution: SyncConfig["conflictResolution"]
): "cloud" | "local" {
  switch (resolution) {
    case "cloud_wins":
      return "cloud";
    case "local_wins":
      return "local";
    case "newest_wins":
      const cloudTime = new Date(cloudPeer.updated_at).getTime();
      const localTime = new Date(localPeer.updated_at).getTime();
      return cloudTime >= localTime ? "cloud" : "local";
    default:
      return "cloud";
  }
}

export async function performSync(syncConfig: SyncConfig): Promise<{ success: boolean; message: string; recordsSynced: number }> {
  const serverConfig = getServerConfig();
  if (!serverConfig?.apiUrl) {
    return { success: false, message: "Local server not configured", recordsSynced: 0 };
  }

  const startTime = Date.now();
  updateSyncStatus({ isRunning: true, direction: syncConfig.direction });

  try {
    const cloudPeers = await fetchCloudPeers();
    const localPeers = await fetchLocalPeers(serverConfig);

    const cloudPeerMap = new Map(cloudPeers.map(p => [p.id, p]));
    const localPeerMap = new Map(localPeers.map(p => [p.id, p]));

    let syncedCount = 0;

    if (syncConfig.direction === "cloud_to_local" || syncConfig.direction === "bidirectional") {
      // Push cloud peers to local
      for (const cloudPeer of cloudPeers) {
        const localPeer = localPeerMap.get(cloudPeer.id);
        if (!localPeer) {
          await pushPeerToLocal(serverConfig, cloudPeer);
          syncedCount++;
        } else if (cloudPeer.updated_at !== localPeer.updated_at) {
          const winner = resolveConflict(cloudPeer, localPeer, syncConfig.conflictResolution);
          if (winner === "cloud") {
            await updatePeerOnLocal(serverConfig, cloudPeer);
            syncedCount++;
          }
        }
      }
    }

    if (syncConfig.direction === "local_to_cloud" || syncConfig.direction === "bidirectional") {
      // Push local peers to cloud
      for (const localPeer of localPeers) {
        const cloudPeer = cloudPeerMap.get(localPeer.id);
        if (!cloudPeer) {
          await pushPeerToCloud(localPeer);
          syncedCount++;
        } else if (cloudPeer.updated_at !== localPeer.updated_at) {
          const winner = resolveConflict(cloudPeer, localPeer, syncConfig.conflictResolution);
          if (winner === "local") {
            await pushPeerToCloud(localPeer);
            syncedCount++;
          }
        }
      }
    }

    const now = new Date().toISOString();
    const duration = Date.now() - startTime;
    
    localStorage.setItem(LAST_SYNC_KEY, now);
    updateSyncStatus({
      isRunning: false,
      lastSync: now,
      lastError: null,
      pendingChanges: 0,
    });

    // Add to sync history
    addToSyncHistory({
      success: true,
      message: `Synced ${syncedCount} peers successfully`,
      direction: syncConfig.direction,
      recordsSynced: syncedCount,
      duration,
    });

    return { success: true, message: `Synced ${syncedCount} peers successfully`, recordsSynced: syncedCount };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const duration = Date.now() - startTime;
    
    updateSyncStatus({
      isRunning: false,
      lastError: errorMessage,
    });

    // Add to sync history
    addToSyncHistory({
      success: false,
      message: errorMessage,
      direction: syncConfig.direction,
      recordsSynced: 0,
      duration,
    });

    return { success: false, message: errorMessage, recordsSynced: 0 };
  }
}

// Sync history management
const SYNC_HISTORY_KEY = "wg_sync_history";
const MAX_HISTORY_ITEMS = 50;

interface SyncHistoryEntry {
  id: string;
  timestamp: string;
  success: boolean;
  message: string;
  direction: SyncConfig["direction"];
  recordsSynced: number;
  duration?: number;
}

function addToSyncHistory(entry: Omit<SyncHistoryEntry, "id" | "timestamp">) {
  const history = getSyncHistory();
  const newEntry: SyncHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  
  history.unshift(newEntry);
  
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

// Auto-sync manager
let syncInterval: NodeJS.Timeout | null = null;

export function startAutoSync(config: SyncConfig) {
  stopAutoSync();
  if (!config.enabled || config.interval < 10) return;

  syncInterval = setInterval(() => {
    performSync(config);
  }, config.interval * 1000);
}

export function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

import { supabase } from "@/integrations/supabase/client";

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wireguard-api`;

export interface WireGuardPeer {
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

export interface ServerSettings {
  is_running?: string;
  public_key?: string;
  endpoint?: string;
  listen_port?: string;
  uptime?: string;
}

export interface TrafficStat {
  id: string;
  peer_id: string;
  rx_bytes: number;
  tx_bytes: number;
  recorded_at: string;
}

export interface BackupData {
  version: string;
  created_at: string;
  data: {
    wireguard_peers: WireGuardPeer[];
    server_settings: Array<{ setting_key: string; setting_value: string }>;
    peer_assignments: unknown[];
    user_roles: unknown[];
    profiles: unknown[];
  };
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

export const api = {
  async getPeers(): Promise<WireGuardPeer[]> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/peers`, { headers });
    if (!response.ok) throw new Error("Failed to fetch peers");
    return response.json();
  },

  async createPeer(peer: Partial<WireGuardPeer>): Promise<WireGuardPeer> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/peers`, {
      method: "POST",
      headers,
      body: JSON.stringify(peer),
    });
    if (!response.ok) throw new Error("Failed to create peer");
    return response.json();
  },

  async updatePeer(id: string, updates: Partial<WireGuardPeer>): Promise<WireGuardPeer> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/peers/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error("Failed to update peer");
    return response.json();
  },

  async deletePeer(id: string): Promise<void> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/peers/${id}`, {
      method: "DELETE",
      headers,
    });
    if (!response.ok) throw new Error("Failed to delete peer");
  },

  async getTrafficStats(peerId?: string, hours = 24): Promise<TrafficStat[]> {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams({ hours: String(hours) });
    if (peerId) params.set("peer_id", peerId);
    
    const response = await fetch(`${API_BASE}/traffic-stats?${params}`, { headers });
    if (!response.ok) throw new Error("Failed to fetch traffic stats");
    return response.json();
  },

  async getBackup(): Promise<BackupData> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/backup`, { headers });
    if (!response.ok) throw new Error("Failed to get backup");
    return response.json();
  },

  async restoreBackup(backup: BackupData): Promise<void> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/restore`, {
      method: "POST",
      headers,
      body: JSON.stringify(backup),
    });
    if (!response.ok) throw new Error("Failed to restore backup");
  },

  async getServerSettings(): Promise<ServerSettings> {
    const { data, error } = await supabase
      .from("server_settings")
      .select("*");
    
    if (error) throw error;
    
    return (data || []).reduce((acc, s) => ({ 
      ...acc, 
      [s.setting_key]: s.setting_value 
    }), {} as ServerSettings);
  },
};

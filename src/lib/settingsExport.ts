const STORAGE_KEY_DB = "wg_manager_db_config";
const STORAGE_KEY_SERVER = "wg_manager_server_config";
const STORAGE_KEY_SYNC = "wg_manager_sync_config";

export interface ExportedSettings {
  version: string;
  exportedAt: string;
  database: {
    host: string;
    port: string;
    database: string;
    username: string;
    password: string;
    useLocalDb: boolean;
  } | null;
  server: {
    apiUrl: string;
    serverToken: string;
    wgEndpoint: string;
    wgPort: string;
    wgPublicKey: string;
  } | null;
  sync: {
    enabled: boolean;
    interval: number;
    direction: string;
    conflictResolution: string;
  } | null;
}

export function exportSettings(): ExportedSettings {
  const dbConfig = localStorage.getItem(STORAGE_KEY_DB);
  const serverConfig = localStorage.getItem(STORAGE_KEY_SERVER);
  const syncConfig = localStorage.getItem(STORAGE_KEY_SYNC);

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    database: dbConfig ? JSON.parse(dbConfig) : null,
    server: serverConfig ? JSON.parse(serverConfig) : null,
    sync: syncConfig ? JSON.parse(syncConfig) : null,
  };
}

export function downloadSettingsFile(settings: ExportedSettings, filename?: string) {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `wg-manager-settings-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importSettings(settings: ExportedSettings): { success: boolean; message: string } {
  try {
    if (!settings.version) {
      return { success: false, message: "Invalid settings file format" };
    }

    if (settings.database) {
      localStorage.setItem(STORAGE_KEY_DB, JSON.stringify(settings.database));
    }

    if (settings.server) {
      localStorage.setItem(STORAGE_KEY_SERVER, JSON.stringify(settings.server));
    }

    if (settings.sync) {
      localStorage.setItem(STORAGE_KEY_SYNC, JSON.stringify(settings.sync));
    }

    return { success: true, message: "Settings imported successfully" };
  } catch (error) {
    return { success: false, message: "Failed to import settings" };
  }
}

export function readSettingsFile(file: File): Promise<ExportedSettings> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

import { useState, useEffect, useCallback } from "react";
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  HardDrive,
  AlertTriangle,
  CheckCircle,
  Table2,
  Info,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const STORAGE_KEY_SERVER = "wg_manager_server_config";

interface DatabaseInfo {
  database: string;
  size: number;
  tables: { table: string; rows: number }[];
  version: string;
}

function getServerConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SERVER);
    if (!raw) return null;
    return JSON.parse(raw) as { apiUrl?: string; serverToken?: string };
  } catch {
    return null;
  }
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { "x-server-token": token } : {};
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function AdminDatabaseBackupRestore() {
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    const config = getServerConfig();
    if (!config?.apiUrl) {
      setError("No server configured.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.apiUrl}/database/info`, {
        headers: authHeaders(config.serverToken),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("Failed to fetch database info");
      setDbInfo(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  const handleBackup = async () => {
    const config = getServerConfig();
    if (!config?.apiUrl) return;
    setBackupLoading(true);
    try {
      const res = await fetch(`${config.apiUrl}/database/backup`, {
        method: "POST",
        headers: authHeaders(config.serverToken),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error("Backup failed");

      const blob = await res.blob();
      const timestamp = new Date().toISOString().split("T")[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pg-backup-${timestamp}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Database backup downloaded (pg_dump)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const config = getServerConfig();
    if (!config?.apiUrl) return;

    setRestoreLoading(true);
    try {
      const sql = await file.text();
      const res = await fetch(`${config.apiUrl}/database/restore`, {
        method: "POST",
        headers: {
          ...authHeaders(config.serverToken),
          "Content-Type": "text/plain",
        },
        body: sql,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Restore failed");
      }
      toast.success("Database restored successfully via psql");
      fetchInfo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoreLoading(false);
      event.target.value = "";
    }
  };

  const totalRows = dbInfo?.tables.reduce((s, t) => s + t.rows, 0) || 0;

  return (
    <Card className="gradient-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>PostgreSQL Backup & Restore</CardTitle>
              <CardDescription>
                Direct pg_dump / psql restore on the Docker PostgreSQL instance
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchInfo} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {dbInfo && (
          <>
            {/* DB overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Database</p>
                <p className="text-sm font-medium text-foreground truncate">{dbInfo.database}</p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Size</p>
                <p className="text-sm font-medium text-foreground">{formatBytes(dbInfo.size)}</p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Tables</p>
                <p className="text-sm font-medium text-foreground">{dbInfo.tables.length}</p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Total Rows</p>
                <p className="text-sm font-medium text-foreground">{totalRows.toLocaleString()}</p>
              </div>
            </div>

            {/* Table breakdown */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Table2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Tables</span>
              </div>
              <div className="grid gap-1.5 max-h-40 overflow-y-auto">
                {dbInfo.tables.map((t) => (
                  <div key={t.table} className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-muted/50">
                    <span className="text-foreground font-mono">{t.table}</span>
                    <Badge variant="secondary" className="text-xs">{t.rows} rows</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Version */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              <span className="truncate">{dbInfo.version}</span>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Create Backup (pg_dump)</h4>
            <p className="text-xs text-muted-foreground">Full SQL dump of the database</p>
            <Button onClick={handleBackup} disabled={backupLoading || !!error} className="w-full gap-2">
              {backupLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {backupLoading ? "Dumping..." : "Download .sql Backup"}
            </Button>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Restore (psql)</h4>
            <p className="text-xs text-muted-foreground">Upload a .sql file to restore</p>
            <Input type="file" accept=".sql" onChange={handleRestore} disabled={restoreLoading || !!error} className="hidden" id="pg-restore-file" />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full gap-2" disabled={restoreLoading || !!error}>
                  {restoreLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {restoreLoading ? "Restoring..." : "Upload .sql Restore"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Restore Database?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will execute the SQL file directly against the database. Existing data may be overwritten.
                    Make sure you have a current backup before proceeding.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => document.getElementById("pg-restore-file")?.click()}>
                    Choose File & Restore
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

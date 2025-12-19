import { useState } from "react";
import { 
  Database, 
  Download, 
  Upload, 
  Cloud, 
  CloudOff, 
  AlertTriangle,
  CheckCircle,
  HardDrive,
  RefreshCw,
  FileJson
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
import { toast } from "sonner";
import { api, BackupData } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";

export function AdminDatabaseControls() {
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [serverToken, setServerToken] = useState("");
  const [backupData, setBackupData] = useState<BackupData | null>(null);

  const handleBackup = async () => {
    setLoading(true);
    try {
      const data = await api.getBackup();
      setBackupData(data);

      // Download as file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wireguard-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Backup downloaded successfully");
    } catch (error) {
      toast.error("Failed to create backup");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as BackupData;

      if (!data.version || !data.data) {
        throw new Error("Invalid backup format");
      }

      await api.restoreBackup(data);
      toast.success("Backup restored successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore backup");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const handleDisableCloud = async () => {
    try {
      // Update setting in database
      await supabase.from("server_settings").upsert({
        setting_key: "cloud_sync_enabled",
        setting_value: "false",
        updated_at: new Date().toISOString(),
      }, { onConflict: "setting_key" });

      setCloudEnabled(false);
      toast.success("Cloud sync disabled. Using local database only.");
    } catch (error) {
      toast.error("Failed to disable cloud sync");
    }
  };

  const handleEnableCloud = async () => {
    try {
      await supabase.from("server_settings").upsert({
        setting_key: "cloud_sync_enabled",
        setting_value: "true",
        updated_at: new Date().toISOString(),
      }, { onConflict: "setting_key" });

      setCloudEnabled(true);
      toast.success("Cloud sync enabled");
    } catch (error) {
      toast.error("Failed to enable cloud sync");
    }
  };

  const generateServerToken = () => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    setServerToken(token);
    toast.success("Token generated. Add this to your server config.");
  };

  return (
    <div className="space-y-6">
      {/* Database Status */}
      <Card className="gradient-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Database Status</CardTitle>
                <CardDescription>Current database connection and sync status</CardDescription>
              </div>
            </div>
            <Badge variant={cloudEnabled ? "default" : "secondary"} className="gap-1">
              {cloudEnabled ? (
                <>
                  <Cloud className="h-3 w-3" />
                  Cloud
                </>
              ) : (
                <>
                  <HardDrive className="h-3 w-3" />
                  Local
                </>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-foreground">Cloud Database</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Connected to Lovable Cloud for remote access and sync
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                {cloudEnabled ? (
                  <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                ) : (
                  <CloudOff className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium text-foreground">Sync Status</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {cloudEnabled ? "Real-time sync enabled" : "Sync disabled - local only"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cloud Sync Control */}
      <Card className="gradient-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Cloud className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Cloud Synchronization</CardTitle>
              <CardDescription>Control data sync between local and cloud databases</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="cloud-sync">Enable Cloud Sync</Label>
              <p className="text-sm text-muted-foreground">
                Sync peer status and traffic data to cloud database
              </p>
            </div>
            <Switch
              id="cloud-sync"
              checked={cloudEnabled}
              onCheckedChange={(checked) => {
                if (checked) {
                  handleEnableCloud();
                } else {
                  handleDisableCloud();
                }
              }}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-sm font-medium text-foreground">Disable Cloud Database</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Completely disable cloud database access. The WireGuard server will use local PostgreSQL only.
              This action requires the installation script to be run with local database setup.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2">
                  <CloudOff className="h-4 w-4" />
                  Disable Cloud Database
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disable Cloud Database?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will disable cloud sync and the system will use local PostgreSQL database only.
                    Make sure you have a local database set up on your WireGuard server.
                    You can re-enable cloud sync later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDisableCloud}>
                    Disable Cloud
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Server Token */}
      <Card className="gradient-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Server Authentication</CardTitle>
              <CardDescription>Generate token for WireGuard server to sync with this dashboard</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={serverToken}
              readOnly
              placeholder="Click generate to create a new token"
              className="font-mono text-xs"
            />
            <Button onClick={generateServerToken} variant="outline">
              Generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Add this token to your server's config.env file as WIREGUARD_SERVER_TOKEN.
            The server will use this token to authenticate API requests.
          </p>
        </CardContent>
      </Card>

      {/* Backup & Restore */}
      <Card className="gradient-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileJson className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Backup & Restore</CardTitle>
              <CardDescription>Export and import database configuration</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Create Backup</h4>
              <p className="text-xs text-muted-foreground">
                Export all peers, settings, and assignments to a JSON file
              </p>
              <Button 
                onClick={handleBackup} 
                disabled={loading}
                className="w-full gap-2"
              >
                <Download className="h-4 w-4" />
                {loading ? "Creating..." : "Download Backup"}
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Restore Backup</h4>
              <p className="text-xs text-muted-foreground">
                Import configuration from a backup JSON file
              </p>
              <div className="relative">
                <Input
                  type="file"
                  accept=".json"
                  onChange={handleRestore}
                  disabled={loading}
                  className="hidden"
                  id="backup-file"
                />
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  disabled={loading}
                  onClick={() => document.getElementById("backup-file")?.click()}
                >
                  <Upload className="h-4 w-4" />
                  {loading ? "Restoring..." : "Upload Backup"}
                </Button>
              </div>
            </div>
          </div>

          {backupData && (
            <div className="p-4 rounded-lg bg-muted/50">
              <h4 className="text-sm font-medium text-foreground mb-2">Last Backup</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Peers:</span>{" "}
                  <span className="text-foreground">{backupData.data.wireguard_peers?.length || 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Settings:</span>{" "}
                  <span className="text-foreground">{backupData.data.server_settings?.length || 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  <span className="text-foreground">
                    {new Date(backupData.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Installation Script */}
      <Card className="gradient-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Installation Script</CardTitle>
              <CardDescription>Download the Ubuntu 22.04 installation script</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This script installs WireGuard, PostgreSQL, and the API sync service on your Ubuntu 22.04 server.
            It includes local database setup, automatic backup, and cloud sync capabilities.
          </p>
          <div className="p-4 rounded-lg bg-muted/50 font-mono text-xs overflow-x-auto">
            <code>
              wget -O install-wireguard.sh https://your-app.lovable.dev/install-wireguard.sh && chmod +x install-wireguard.sh && sudo ./install-wireguard.sh
            </code>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open("/install-wireguard.sh", "_blank")}
          >
            <Download className="h-4 w-4" />
            Download Script
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

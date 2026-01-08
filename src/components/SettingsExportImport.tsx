import { useState, useRef } from "react";
import { Download, Upload, FileJson, Check, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  exportSettings,
  downloadSettingsFile,
  importSettings,
  readSettingsFile,
  ExportedSettings,
} from "@/lib/settingsExport";

interface SettingsExportImportProps {
  onImportComplete?: () => void;
}

export function SettingsExportImport({ onImportComplete }: SettingsExportImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [previewData, setPreviewData] = useState<ExportedSettings | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const handleExport = () => {
    const settings = exportSettings();
    downloadSettingsFile(settings);
    toast.success("Settings exported successfully");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const data = await readSettingsFile(file);
      setPreviewData(data);
      setShowConfirmDialog(true);
    } catch (error) {
      toast.error("Failed to read settings file");
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const confirmImport = () => {
    if (!previewData) return;

    const result = importSettings(previewData);
    if (result.success) {
      toast.success(result.message);
      onImportComplete?.();
    } else {
      toast.error(result.message);
    }

    setShowConfirmDialog(false);
    setPreviewData(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-primary" />
            Export / Import Settings
          </CardTitle>
          <CardDescription>
            Transfer settings between devices or create backups
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={handleExport}
              className="gap-2 h-auto py-4 flex-col"
            >
              <Download className="h-6 w-6" />
              <div>
                <p className="font-medium">Export Settings</p>
                <p className="text-xs text-muted-foreground">Download as JSON file</p>
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={handleImportClick}
              disabled={importing}
              className="gap-2 h-auto py-4 flex-col"
            >
              {importing ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Upload className="h-6 w-6" />
              )}
              <div>
                <p className="font-medium">Import Settings</p>
                <p className="text-xs text-muted-foreground">Load from JSON file</p>
              </div>
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Exported settings include database configuration, server settings, and sync preferences.
              Passwords are included - keep the file secure!
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Settings</DialogTitle>
            <DialogDescription>
              Review the settings before importing. This will overwrite your current configuration.
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4 max-h-[300px] overflow-y-auto">
              <div className="text-sm space-y-2">
                <p className="text-muted-foreground">
                  Exported: {new Date(previewData.exportedAt).toLocaleString()}
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {previewData.database ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>Database Configuration</span>
                    {previewData.database && (
                      <span className="text-muted-foreground">
                        ({previewData.database.host}:{previewData.database.port})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {previewData.server ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>Server Configuration</span>
                    {previewData.server?.apiUrl && (
                      <span className="text-muted-foreground truncate max-w-[200px]">
                        ({previewData.server.apiUrl})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {previewData.sync ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>Sync Configuration</span>
                    {previewData.sync?.enabled && (
                      <span className="text-muted-foreground">
                        (enabled, every {previewData.sync.interval}s)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmImport}>
              Import Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

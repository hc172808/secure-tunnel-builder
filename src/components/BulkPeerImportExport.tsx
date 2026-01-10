import { useState, useRef } from "react";
import { Download, Upload, FileJson, Check, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { generateKeyPair } from "@/lib/wireguardKeys";

interface PeerGroup {
  id: string;
  name: string;
  color: string;
}

interface ExportedPeer {
  name: string;
  public_key: string;
  private_key?: string;
  allowed_ips: string;
  dns?: string;
  persistent_keepalive?: number;
  group_name?: string;
}

interface ImportResult {
  success: boolean;
  name: string;
  error?: string;
}

interface BulkPeerImportExportProps {
  onImportComplete?: () => void;
}

export function BulkPeerImportExport({ onImportComplete }: BulkPeerImportExportProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("export");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importData, setImportData] = useState("");
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [previewPeers, setPreviewPeers] = useState<ExportedPeer[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Fetch peers with their groups
      const { data: peers, error: peersError } = await supabase
        .from("wireguard_peers")
        .select(`
          name,
          public_key,
          private_key,
          allowed_ips,
          dns,
          persistent_keepalive,
          group_id,
          peer_groups (
            name
          )
        `)
        .order("name");

      if (peersError) throw peersError;

      // Format for export
      const exportData: ExportedPeer[] = (peers || []).map((peer) => ({
        name: peer.name,
        public_key: peer.public_key,
        private_key: peer.private_key || undefined,
        allowed_ips: peer.allowed_ips,
        dns: peer.dns || undefined,
        persistent_keepalive: peer.persistent_keepalive || undefined,
        group_name: (peer.peer_groups as { name: string } | null)?.name || undefined,
      }));

      const exportContent = {
        version: "1.0",
        exported_at: new Date().toISOString(),
        peers_count: exportData.length,
        peers: exportData,
      };

      // Create and download file
      const blob = new Blob([JSON.stringify(exportContent, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wireguard-peers-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${exportData.length} peers`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export peers");
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportData(content);
      parsePreview(content);
    };
    reader.readAsText(file);
  };

  const parsePreview = (content: string) => {
    try {
      const data = JSON.parse(content);
      if (data.peers && Array.isArray(data.peers)) {
        setPreviewPeers(data.peers);
      } else if (Array.isArray(data)) {
        setPreviewPeers(data);
      } else {
        throw new Error("Invalid format");
      }
    } catch (error) {
      setPreviewPeers([]);
      toast.error("Invalid JSON format");
    }
  };

  const handleImport = async () => {
    if (previewPeers.length === 0) {
      toast.error("No peers to import");
      return;
    }

    setImporting(true);
    setImportResults([]);

    try {
      // Fetch existing groups
      const { data: groups } = await supabase
        .from("peer_groups")
        .select("id, name");

      const groupMap = new Map(
        (groups || []).map((g) => [g.name.toLowerCase(), g.id])
      );

      // Fetch existing peers to check for duplicates
      const { data: existingPeers } = await supabase
        .from("wireguard_peers")
        .select("name, public_key");

      const existingNames = new Set(
        (existingPeers || []).map((p) => p.name.toLowerCase())
      );
      const existingKeys = new Set(
        (existingPeers || []).map((p) => p.public_key)
      );

      const results: ImportResult[] = [];

      for (const peer of previewPeers) {
        try {
          // Check for duplicate name
          if (existingNames.has(peer.name.toLowerCase())) {
            results.push({
              success: false,
              name: peer.name,
              error: "Peer with this name already exists",
            });
            continue;
          }

          // Generate keys if not provided
          let publicKey = peer.public_key;
          let privateKey = peer.private_key;

          if (!publicKey) {
            const keyPair = await generateKeyPair();
            publicKey = keyPair.publicKey;
            privateKey = keyPair.privateKey;
          }

          // Check for duplicate public key
          if (existingKeys.has(publicKey)) {
            results.push({
              success: false,
              name: peer.name,
              error: "Peer with this public key already exists",
            });
            continue;
          }

          // Find group ID
          let groupId: string | null = null;
          if (peer.group_name) {
            groupId = groupMap.get(peer.group_name.toLowerCase()) || null;
          }

          // Insert peer
          const { error } = await supabase.from("wireguard_peers").insert({
            name: peer.name,
            public_key: publicKey,
            private_key: privateKey || null,
            allowed_ips: peer.allowed_ips || "10.0.0.2/32",
            dns: peer.dns || "1.1.1.1",
            persistent_keepalive: peer.persistent_keepalive || 25,
            group_id: groupId,
            status: "pending",
          });

          if (error) throw error;

          results.push({ success: true, name: peer.name });
          existingNames.add(peer.name.toLowerCase());
          existingKeys.add(publicKey);
        } catch (error) {
          results.push({
            success: false,
            name: peer.name,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      setImportResults(results);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (successCount > 0) {
        toast.success(`Imported ${successCount} peers`);
        onImportComplete?.();
      }
      if (failCount > 0) {
        toast.warning(`${failCount} peers failed to import`);
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import peers");
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setImportData("");
    setPreviewPeers([]);
    setImportResults([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileJson className="h-4 w-4" />
          Import/Export
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">Bulk Import/Export Peers</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Export all peers or import peers from a JSON file with group assignments.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </TabsTrigger>
            <TabsTrigger value="import" className="gap-2">
              <Upload className="h-4 w-4" />
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="space-y-4">
            <div className="p-4 rounded-lg bg-secondary/30 space-y-2">
              <p className="text-sm text-foreground">
                Export all peers with their configurations and group assignments to a JSON file.
              </p>
              <p className="text-xs text-muted-foreground">
                The export includes: name, public/private keys, allowed IPs, DNS, keepalive, and group name.
              </p>
            </div>
            <Button onClick={handleExport} disabled={exporting} className="w-full gap-2">
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export All Peers"}
            </Button>
          </TabsContent>

          <TabsContent value="import" className="space-y-4">
            <div className="space-y-2">
              <Label>Upload JSON File</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary file:text-primary-foreground
                  hover:file:bg-primary/90
                  cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <Label>Or Paste JSON</Label>
              <Textarea
                value={importData}
                onChange={(e) => {
                  setImportData(e.target.value);
                  parsePreview(e.target.value);
                }}
                placeholder='{"peers": [{"name": "peer1", "allowed_ips": "10.0.0.2/32", "group_name": "Mobile"}]}'
                className="bg-secondary border-border font-mono text-xs min-h-[100px]"
              />
            </div>

            {previewPeers.length > 0 && (
              <div className="space-y-2">
                <Label>Preview ({previewPeers.length} peers)</Label>
                <ScrollArea className="h-[150px] rounded-md border border-border p-2">
                  <div className="space-y-2">
                    {previewPeers.map((peer, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 rounded bg-secondary/30"
                      >
                        <div>
                          <span className="text-sm font-medium text-foreground">
                            {peer.name}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {peer.allowed_ips}
                          </span>
                        </div>
                        {peer.group_name && (
                          <Badge variant="secondary" className="text-xs">
                            {peer.group_name}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {importResults.length > 0 && (
              <div className="space-y-2">
                <Label>Import Results</Label>
                <ScrollArea className="h-[150px] rounded-md border border-border p-2">
                  <div className="space-y-2">
                    {importResults.map((result, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-2 p-2 rounded ${
                          result.success
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {result.success ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        <span className="text-sm font-medium">{result.name}</span>
                        {result.error && (
                          <span className="text-xs ml-auto">{result.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <Button
              onClick={handleImport}
              disabled={importing || previewPeers.length === 0}
              className="w-full gap-2"
            >
              <Upload className="h-4 w-4" />
              {importing
                ? "Importing..."
                : `Import ${previewPeers.length} Peer${previewPeers.length !== 1 ? "s" : ""}`}
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

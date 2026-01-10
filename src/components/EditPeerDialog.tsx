import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Copy, Check, Key, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { generateKeyPair, WireGuardKeyPair } from "@/lib/wireguardKeys";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PeerGroup {
  id: string;
  name: string;
  color: string;
}

interface Peer {
  id: string;
  name: string;
  publicKey: string;
  privateKey?: string;
  allowedIPs: string;
  endpoint?: string;
  dns?: string;
  persistentKeepalive?: number;
  status: "connected" | "disconnected" | "pending";
  groupId?: string | null;
}

interface EditPeerDialogProps {
  peer: Peer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (peer: {
    id: string;
    name: string;
    allowedIPs: string;
    publicKey: string;
    privateKey?: string;
    dns?: string;
    persistentKeepalive?: number;
    groupId?: string | null;
  }) => void;
}

export function EditPeerDialog({ peer, open, onOpenChange, onSave }: EditPeerDialogProps) {
  const [name, setName] = useState("");
  const [allowedIPs, setAllowedIPs] = useState("");
  const [dns, setDns] = useState("");
  const [persistentKeepalive, setPersistentKeepalive] = useState<string>("25");
  const [currentPublicKey, setCurrentPublicKey] = useState("");
  const [newKeyPair, setNewKeyPair] = useState<WireGuardKeyPair | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [keysRegenerated, setKeysRegenerated] = useState(false);
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Fetch groups
  useEffect(() => {
    const fetchGroups = async () => {
      setLoadingGroups(true);
      try {
        const { data, error } = await supabase
          .from("peer_groups")
          .select("id, name, color")
          .order("name");

        if (error) throw error;
        setGroups(data || []);
      } catch (error) {
        console.error("Error fetching groups:", error);
      } finally {
        setLoadingGroups(false);
      }
    };

    if (open) {
      fetchGroups();
    }
  }, [open]);

  // Load peer data when dialog opens
  useEffect(() => {
    if (open && peer) {
      setName(peer.name);
      setAllowedIPs(peer.allowedIPs);
      setDns(peer.dns || "1.1.1.1");
      setPersistentKeepalive(peer.persistentKeepalive?.toString() || "25");
      setCurrentPublicKey(peer.publicKey);
      setSelectedGroupId(peer.groupId || null);
      setNewKeyPair(null);
      setKeysRegenerated(false);
      setShowPrivateKey(false);
    }
  }, [open, peer]);

  const handleRegenerateKeys = async () => {
    setIsGenerating(true);
    try {
      const newPair = await generateKeyPair();
      setNewKeyPair(newPair);
      setKeysRegenerated(true);
      toast.success("New keys generated - remember to save!");
    } catch (error) {
      toast.error("Failed to generate keys");
    } finally {
      setIsGenerating(false);
      setShowRegenerateConfirm(false);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!peer) return;

    if (!name.trim()) {
      toast.error("Please enter a peer name");
      return;
    }

    if (!allowedIPs.trim()) {
      toast.error("Please enter allowed IPs");
      return;
    }

    onSave({
      id: peer.id,
      name,
      allowedIPs,
      publicKey: newKeyPair?.publicKey || currentPublicKey,
      privateKey: newKeyPair?.privateKey,
      dns: dns || undefined,
      persistentKeepalive: persistentKeepalive ? parseInt(persistentKeepalive, 10) : undefined,
      groupId: selectedGroupId,
    });
    
    onOpenChange(false);
  };

  const handleClose = () => {
    setNewKeyPair(null);
    setKeysRegenerated(false);
    setShowPrivateKey(false);
    onOpenChange(false);
  };

  if (!peer) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="bg-card border-border sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-foreground">Edit Peer</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Modify peer configuration. You can also regenerate keys if needed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name" className="text-foreground">
                  Peer Name
                </Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., laptop, phone, server"
                  className="bg-secondary border-border"
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="edit-allowedIPs" className="text-foreground">
                  Allowed IPs
                </Label>
                <Input
                  id="edit-allowedIPs"
                  value={allowedIPs}
                  onChange={(e) => setAllowedIPs(e.target.value)}
                  placeholder="10.0.0.2/32"
                  className="bg-secondary border-border font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-dns" className="text-foreground">
                    DNS Server
                  </Label>
                  <Input
                    id="edit-dns"
                    value={dns}
                    onChange={(e) => setDns(e.target.value)}
                    placeholder="1.1.1.1"
                    className="bg-secondary border-border font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-keepalive" className="text-foreground">
                    Keepalive (seconds)
                  </Label>
                  <Input
                    id="edit-keepalive"
                    type="number"
                    value={persistentKeepalive}
                    onChange={(e) => setPersistentKeepalive(e.target.value)}
                    placeholder="25"
                    className="bg-secondary border-border font-mono"
                  />
                </div>
              </div>

              {/* Group Selection */}
              <div className="grid gap-2">
                <Label htmlFor="edit-group" className="text-foreground">
                  Peer Group
                </Label>
                <Select
                  value={selectedGroupId || "none"}
                  onValueChange={(value) => setSelectedGroupId(value === "none" ? null : value)}
                  disabled={loadingGroups}
                >
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Select a group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                        No Group
                      </div>
                    </SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          {group.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Key Section */}
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-foreground flex items-center gap-2">
                    <Key className="h-4 w-4 text-primary" />
                    WireGuard Keys
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRegenerateConfirm(true)}
                    disabled={isGenerating}
                    className="gap-1 text-xs"
                  >
                    <RefreshCw className={`h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
                    Regenerate Keys
                  </Button>
                </div>

                {keysRegenerated && newKeyPair ? (
                  <div className="space-y-3">
                    <div className="p-2 rounded-md bg-warning/10 border border-warning/20">
                      <p className="text-xs text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        New keys generated - update your client config!
                      </p>
                    </div>

                    {/* New Public Key */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">New Public Key</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={newKeyPair.publicKey}
                          readOnly
                          className="bg-muted border-border font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleCopy(newKeyPair.publicKey, "Public Key")}
                          className="flex-shrink-0"
                        >
                          {copiedField === "Public Key" ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* New Private Key */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">New Private Key (keep secret!)</Label>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            value={showPrivateKey ? newKeyPair.privateKey : "•".repeat(44)}
                            readOnly
                            className="bg-muted border-border font-mono text-xs pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowPrivateKey(!showPrivateKey)}
                            className="absolute right-0 top-0 h-full px-3"
                          >
                            {showPrivateKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleCopy(newKeyPair.privateKey, "Private Key")}
                          className="flex-shrink-0"
                        >
                          {copiedField === "Private Key" ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-destructive/80">
                        ⚠️ Save this private key now - it won't be shown again!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Current Public Key</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={currentPublicKey}
                        readOnly
                        className="bg-muted border-border font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleCopy(currentPublicKey, "Public Key")}
                        className="flex-shrink-0"
                      >
                        {copiedField === "Public Key" ? (
                          <Check className="h-4 w-4 text-success" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Click "Regenerate Keys" to create new key pair
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit">
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Regenerate Confirmation Dialog */}
      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Regenerate Keys?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will generate a new key pair. The old keys will be replaced when you save.
              You'll need to update your client configuration with the new private key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerateKeys} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                "Regenerate"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

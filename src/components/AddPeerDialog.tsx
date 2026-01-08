import { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, RefreshCw, Copy, Check, Key, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { generateKeyPair, WireGuardKeyPair } from "@/lib/wireguardKeys";

interface AddPeerDialogProps {
  onAddPeer: (peer: {
    name: string;
    allowedIPs: string;
    publicKey: string;
    privateKey: string;
  }) => void;
}

export function AddPeerDialog({ onAddPeer }: AddPeerDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [allowedIPs, setAllowedIPs] = useState("10.0.0.");
  const [keyPair, setKeyPair] = useState<WireGuardKeyPair | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // Generate keys when dialog opens
  useEffect(() => {
    if (open && !keyPair) {
      generateKeys();
    }
  }, [open]);

  const generateKeys = async () => {
    setIsGenerating(true);
    try {
      const newKeyPair = await generateKeyPair();
      setKeyPair(newKeyPair);
    } catch (error) {
      toast.error("Failed to generate keys");
    } finally {
      setIsGenerating(false);
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
    
    if (!name.trim()) {
      toast.error("Please enter a peer name");
      return;
    }

    if (!allowedIPs.trim()) {
      toast.error("Please enter allowed IPs");
      return;
    }

    if (!keyPair) {
      toast.error("Keys not generated yet");
      return;
    }

    onAddPeer({ 
      name, 
      allowedIPs,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    });
    
    // Reset form
    setName("");
    setAllowedIPs("10.0.0.");
    setKeyPair(null);
    setShowPrivateKey(false);
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset on close
      setName("");
      setAllowedIPs("10.0.0.");
      setKeyPair(null);
      setShowPrivateKey(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Peer
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">Add New Peer</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a new WireGuard peer. Keys are automatically generated - just copy and paste them into your client config.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-foreground">
                Peer Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., laptop, phone, server"
                className="bg-secondary border-border"
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="allowedIPs" className="text-foreground">
                Allowed IPs
              </Label>
              <Input
                id="allowedIPs"
                value={allowedIPs}
                onChange={(e) => setAllowedIPs(e.target.value)}
                placeholder="10.0.0.2/32"
                className="bg-secondary border-border font-mono"
              />
              <p className="text-xs text-muted-foreground">
                The IP address range this peer is allowed to use
              </p>
            </div>

            {/* Key Generation Section */}
            <div className="space-y-3 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <Label className="text-foreground flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary" />
                  WireGuard Keys
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={generateKeys}
                  disabled={isGenerating}
                  className="gap-1 text-xs"
                >
                  <RefreshCw className={`h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
                  Regenerate
                </Button>
              </div>

              {keyPair ? (
                <div className="space-y-3">
                  {/* Public Key */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Public Key</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={keyPair.publicKey}
                        readOnly
                        className="bg-muted border-border font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleCopy(keyPair.publicKey, "Public Key")}
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

                  {/* Private Key */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Private Key (keep secret!)</Label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          value={showPrivateKey ? keyPair.privateKey : "•".repeat(44)}
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
                        onClick={() => handleCopy(keyPair.privateKey, "Private Key")}
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
                      ⚠️ Save this private key now - it won't be shown again after creation!
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Generating keys...
                </div>
              )}
            </div>
          </div>
          
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!keyPair || isGenerating}>
              Create Peer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

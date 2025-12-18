import { useState } from "react";
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
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface AddPeerDialogProps {
  onAddPeer: (peer: {
    name: string;
    allowedIPs: string;
  }) => void;
}

export function AddPeerDialog({ onAddPeer }: AddPeerDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [allowedIPs, setAllowedIPs] = useState("10.0.0.");

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

    onAddPeer({ name, allowedIPs });
    setName("");
    setAllowedIPs("10.0.0.");
    setOpen(false);
    toast.success(`Peer "${name}" added successfully`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Peer
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">Add New Peer</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a new WireGuard peer. A key pair will be automatically generated.
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Peer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

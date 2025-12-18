import { Copy, MoreVertical, Trash2, Settings, Download, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface Peer {
  id: string;
  name: string;
  publicKey: string;
  allowedIPs: string;
  endpoint?: string;
  lastHandshake?: string;
  transferRx?: string;
  transferTx?: string;
  status: "connected" | "disconnected" | "pending";
}

interface PeerCardProps {
  peer: Peer;
  onDelete?: (id: string) => void;
  onViewConfig?: (id: string) => void;
  onViewQR?: (id: string) => void;
  isAdmin?: boolean;
}

export function PeerCard({ peer, onDelete, onViewConfig, onViewQR, isAdmin = false }: PeerCardProps) {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div className="gradient-border group rounded-xl p-5 transition-all duration-300 hover:scale-[1.01]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 text-primary font-mono font-bold">
            {peer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{peer.name}</h3>
            <p className="text-xs text-muted-foreground">{peer.allowedIPs}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={peer.status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border">
              <DropdownMenuItem onClick={() => onViewConfig?.(peer.id)} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                View Config
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewQR?.(peer.id)} className="cursor-pointer">
                <QrCode className="mr-2 h-4 w-4" />
                Show QR Code
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyToClipboard(peer.publicKey, "Public key")} className="cursor-pointer">
                <Copy className="mr-2 h-4 w-4" />
                Copy Public Key
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Download className="mr-2 h-4 w-4" />
                Download Config
              </DropdownMenuItem>
              {isAdmin && onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => onDelete(peer.id)} 
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Peer
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Last Handshake</p>
          <p className="text-sm font-mono text-foreground">
            {peer.lastHandshake || "Never"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Endpoint</p>
          <p className="text-sm font-mono text-foreground">
            {peer.endpoint || "N/A"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">↓ Received</p>
          <p className="text-sm font-mono text-success">
            {peer.transferRx || "0 B"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">↑ Sent</p>
          <p className="text-sm font-mono text-primary">
            {peer.transferTx || "0 B"}
          </p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground mb-1">Public Key</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground truncate">
            {peer.publicKey}
          </code>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 shrink-0"
            onClick={() => copyToClipboard(peer.publicKey, "Public key")}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

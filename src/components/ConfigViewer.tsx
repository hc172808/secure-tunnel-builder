import { Copy, Download, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ConfigViewerProps {
  open: boolean;
  onClose: () => void;
  peerName: string;
  config: string;
  onViewQR?: () => void;
}

export function ConfigViewer({ open, onClose, peerName, config, onViewQR }: ConfigViewerProps) {
  const copyConfig = () => {
    navigator.clipboard.writeText(config);
    toast.success("Configuration copied to clipboard");
  };

  const downloadConfig = () => {
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peerName.toLowerCase().replace(/\s+/g, "-")}.conf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Configuration file downloaded");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <span className="text-primary font-mono">[{peerName}]</span>
            Configuration
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Use this configuration file on your client device
          </DialogDescription>
        </DialogHeader>
        
        <div className="relative">
          <pre className="rounded-lg bg-muted p-4 text-sm font-mono text-foreground overflow-x-auto max-h-[400px] overflow-y-auto">
            {config}
          </pre>
          <div className="absolute top-2 right-2 flex gap-1">
            <Button 
              variant="secondary" 
              size="icon" 
              className="h-8 w-8"
              onClick={copyConfig}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button 
              variant="secondary" 
              size="icon" 
              className="h-8 w-8"
              onClick={downloadConfig}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          {onViewQR && (
            <Button variant="glow" className="flex-1" onClick={onViewQR}>
              <QrCode className="h-4 w-4 mr-2" />
              Show QR Code
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <p className="text-xs text-primary">
            Scan the QR code or import this file in your WireGuard client
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

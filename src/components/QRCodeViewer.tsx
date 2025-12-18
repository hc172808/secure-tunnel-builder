import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Copy } from "lucide-react";
import { toast } from "sonner";

interface QRCodeViewerProps {
  open: boolean;
  onClose: () => void;
  peerName: string;
  config: string;
}

export function QRCodeViewer({ open, onClose, peerName, config }: QRCodeViewerProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    if (open && config) {
      QRCode.toDataURL(config, {
        width: 300,
        margin: 2,
        color: {
          dark: "#ffffff",
          light: "#0a0a0a",
        },
        errorCorrectionLevel: "M",
      })
        .then(setQrDataUrl)
        .catch(console.error);
    }
  }, [open, config]);

  const downloadQR = () => {
    if (!qrDataUrl) return;
    
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${peerName.toLowerCase().replace(/\s+/g, "-")}-qr.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("QR code downloaded");
  };

  const copyConfig = () => {
    navigator.clipboard.writeText(config);
    toast.success("Configuration copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <span className="text-primary font-mono">[{peerName}]</span>
            QR Code
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Scan with WireGuard mobile app to import configuration
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {qrDataUrl ? (
            <div className="p-4 rounded-xl bg-muted border border-border">
              <img src={qrDataUrl} alt="WireGuard QR Code" className="w-[250px] h-[250px]" />
            </div>
          ) : (
            <div className="w-[250px] h-[250px] rounded-xl bg-muted animate-pulse flex items-center justify-center">
              <span className="text-muted-foreground text-sm">Generating...</span>
            </div>
          )}

          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={copyConfig}>
              <Copy className="h-4 w-4 mr-2" />
              Copy Config
            </Button>
            <Button variant="glow" className="flex-1" onClick={downloadQR}>
              <Download className="h-4 w-4 mr-2" />
              Download QR
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <p className="text-xs text-primary">
            Open WireGuard app → Add tunnel → Scan QR code
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Download, Smartphone, Monitor, Tablet, Apple, Chrome } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface DownloadOption {
  name: string;
  platform: string;
  icon: React.ReactNode;
  url: string;
  description: string;
}

const downloadOptions: DownloadOption[] = [
  {
    name: "Windows",
    platform: "windows",
    icon: <Monitor className="h-8 w-8" />,
    url: "https://download.wireguard.com/windows-client/wireguard-installer.exe",
    description: "Windows 7, 8, 10, 11",
  },
  {
    name: "macOS",
    platform: "macos",
    icon: <Apple className="h-8 w-8" />,
    url: "https://apps.apple.com/app/wireguard/id1451685025",
    description: "macOS 12+",
  },
  {
    name: "Linux",
    platform: "linux",
    icon: <Monitor className="h-8 w-8" />,
    url: "https://www.wireguard.com/install/",
    description: "Ubuntu, Debian, Fedora, etc.",
  },
  {
    name: "iOS",
    platform: "ios",
    icon: <Smartphone className="h-8 w-8" />,
    url: "https://apps.apple.com/app/wireguard/id1441195209",
    description: "iPhone & iPad",
  },
  {
    name: "Android",
    platform: "android",
    icon: <Smartphone className="h-8 w-8" />,
    url: "https://play.google.com/store/apps/details?id=com.wireguard.android",
    description: "Android 5.0+",
  },
  {
    name: "Chrome OS",
    platform: "chromeos",
    icon: <Chrome className="h-8 w-8" />,
    url: "https://play.google.com/store/apps/details?id=com.wireguard.android",
    description: "Chromebook",
  },
];

interface DownloadAppsProps {
  peerConfig?: string;
  peerName?: string;
}

export function DownloadApps({ peerConfig, peerName }: DownloadAppsProps) {
  const [open, setOpen] = useState(false);

  const handleDownload = (option: DownloadOption) => {
    window.open(option.url, "_blank");
    toast.success(`Opening ${option.name} download page`);
  };

  const downloadConfig = () => {
    if (!peerConfig || !peerName) {
      toast.error("No configuration available");
      return;
    }

    const blob = new Blob([peerConfig], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peerName.replace(/\s+/g, "-").toLowerCase()}.conf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Configuration file downloaded");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Download Apps
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Download WireGuard</DialogTitle>
          <DialogDescription>
            Choose your platform to download the WireGuard client app
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 py-4">
          {downloadOptions.map((option) => (
            <button
              key={option.platform}
              onClick={() => handleDownload(option)}
              className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:bg-accent hover:border-primary transition-colors text-center"
            >
              <div className="text-primary">{option.icon}</div>
              <div>
                <p className="font-medium">{option.name}</p>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
        {peerConfig && (
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-3">
              Download your configuration file to import into the app:
            </p>
            <Button onClick={downloadConfig} className="w-full gap-2">
              <Download className="h-4 w-4" />
              Download {peerName || "Config"} (.conf)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

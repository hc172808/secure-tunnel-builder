import { useState, useEffect } from "react";
import { Copy, RefreshCw, Eye, EyeOff, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";

export function ApiTokenViewer() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && user) {
      fetchApiToken();
    }
  }, [open, user]);

  const fetchApiToken = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("profiles")
      .select("api_token")
      .eq("user_id", user.id)
      .single();

    if (!error && data) {
      setApiToken(data.api_token);
    }
  };

  const regenerateToken = async () => {
    if (!user) return;
    
    setLoading(true);
    
    // Generate new token
    const newToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    
    const { error } = await supabase
      .from("profiles")
      .update({ api_token: newToken } as any)
      .eq("user_id", user.id);

    if (error) {
      toast.error("Failed to regenerate token");
    } else {
      setApiToken(newToken);
      toast.success("API token regenerated");
    }
    
    setLoading(false);
  };

  const copyToken = () => {
    if (apiToken) {
      navigator.clipboard.writeText(apiToken);
      toast.success("API token copied to clipboard");
    }
  };

  const copyScript = (script: string) => {
    navigator.clipboard.writeText(script);
    toast.success("Script copied to clipboard");
  };

  const bashScript = `#!/bin/bash
# WireGuard Peer Creation Script
# This script will create a peer request that needs admin approval

API_TOKEN="${apiToken || 'YOUR_API_TOKEN'}"
API_URL="${window.location.origin}"
PEER_NAME="my-device-$(hostname)"

# Create peer request
curl -X POST "\${API_URL}/functions/v1/wireguard-api/peer-request" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Token: \${API_TOKEN}" \\
  -d '{
    "name": "'\${PEER_NAME}'",
    "allowed_ips": "10.0.0.0/24"
  }'

echo "Peer request submitted. Waiting for admin approval..."`;

  const pythonScript = `#!/usr/bin/env python3
"""WireGuard Peer Creation Script"""
import requests
import socket

API_TOKEN = "${apiToken || 'YOUR_API_TOKEN'}"
API_URL = "${window.location.origin}"
PEER_NAME = f"my-device-{socket.gethostname()}"

response = requests.post(
    f"{API_URL}/functions/v1/wireguard-api/peer-request",
    headers={
        "Content-Type": "application/json",
        "X-API-Token": API_TOKEN
    },
    json={
        "name": PEER_NAME,
        "allowed_ips": "10.0.0.0/24"
    }
)

if response.ok:
    print("Peer request submitted. Waiting for admin approval...")
else:
    print(f"Error: {response.text}")`;

  const powershellScript = `# WireGuard Peer Creation Script for Windows
$ApiToken = "${apiToken || 'YOUR_API_TOKEN'}"
$ApiUrl = "${window.location.origin}"
$PeerName = "my-device-$env:COMPUTERNAME"

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Token" = $ApiToken
}

$body = @{
    name = $PeerName
    allowed_ips = "10.0.0.0/24"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$ApiUrl/functions/v1/wireguard-api/peer-request" \`
        -Method POST \`
        -Headers $headers \`
        -Body $body
    
    Write-Host "Peer request submitted. Waiting for admin approval..."
} catch {
    Write-Host "Error: $_"
}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Code className="h-4 w-4 mr-2" />
          API & Scripts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>API Token & Scripts</DialogTitle>
          <DialogDescription>
            Use these scripts to automatically create peer requests from any device
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Your API Token</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={apiToken || "Loading..."}
                  readOnly
                  className="pr-20 font-mono text-sm"
                />
                <button
                  type="button"
                  className="absolute right-10 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={copyToken}
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <Button variant="outline" size="icon" onClick={regenerateToken} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          <Tabs defaultValue="bash" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="bash">Bash</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="powershell">PowerShell</TabsTrigger>
            </TabsList>
            
            <TabsContent value="bash" className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Linux/macOS</span>
                <Button variant="ghost" size="sm" onClick={() => copyScript(bashScript)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </div>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-64">
                {bashScript}
              </pre>
            </TabsContent>
            
            <TabsContent value="python" className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Cross-platform</span>
                <Button variant="ghost" size="sm" onClick={() => copyScript(pythonScript)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </div>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-64">
                {pythonScript}
              </pre>
            </TabsContent>
            
            <TabsContent value="powershell" className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Windows</span>
                <Button variant="ghost" size="sm" onClick={() => copyScript(powershellScript)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </div>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-64">
                {powershellScript}
              </pre>
            </TabsContent>
          </Tabs>

          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
            <strong>Note:</strong> Peer requests created via API require admin approval before becoming active.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

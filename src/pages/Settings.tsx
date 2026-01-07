import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Database, Server, Shield, Save, TestTube, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";

interface DatabaseConfig {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  useLocalDb: boolean;
}

interface ServerConfig {
  apiUrl: string;
  serverToken: string;
  wgEndpoint: string;
  wgPort: string;
  wgPublicKey: string;
}

const STORAGE_KEY_DB = "wg_manager_db_config";
const STORAGE_KEY_SERVER = "wg_manager_server_config";

export default function Settings() {
  const navigate = useNavigate();
  const { user, loading, isAdmin } = useAuth();
  
  const [dbConfig, setDbConfig] = useState<DatabaseConfig>({
    host: "localhost",
    port: "5432",
    database: "wireguard_manager",
    username: "wgadmin",
    password: "",
    useLocalDb: false,
  });
  
  const [serverConfig, setServerConfig] = useState<ServerConfig>({
    apiUrl: "",
    serverToken: "",
    wgEndpoint: "",
    wgPort: "51820",
    wgPublicKey: "",
  });
  
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Load saved configurations
  useEffect(() => {
    const savedDbConfig = localStorage.getItem(STORAGE_KEY_DB);
    const savedServerConfig = localStorage.getItem(STORAGE_KEY_SERVER);
    
    if (savedDbConfig) {
      try {
        setDbConfig(JSON.parse(savedDbConfig));
      } catch (e) {
        console.error("Failed to parse saved DB config");
      }
    }
    
    if (savedServerConfig) {
      try {
        setServerConfig(JSON.parse(savedServerConfig));
      } catch (e) {
        console.error("Failed to parse saved server config");
      }
    }
  }, []);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus("idle");
    
    try {
      // Simulate connection test - in production this would call the API
      const testUrl = serverConfig.apiUrl || `http://${dbConfig.host}:3001`;
      const response = await fetch(`${testUrl}/health`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(serverConfig.serverToken && { "x-server-token": serverConfig.serverToken }),
        },
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        setConnectionStatus("success");
        toast.success("Connection successful!");
      } else {
        throw new Error("Connection failed");
      }
    } catch (error) {
      setConnectionStatus("error");
      toast.error("Connection failed. Check your settings.");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveConfig = () => {
    setSaving(true);
    
    try {
      localStorage.setItem(STORAGE_KEY_DB, JSON.stringify(dbConfig));
      localStorage.setItem(STORAGE_KEY_SERVER, JSON.stringify(serverConfig));
      toast.success("Configuration saved successfully");
    } catch (error) {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleClearConfig = () => {
    localStorage.removeItem(STORAGE_KEY_DB);
    localStorage.removeItem(STORAGE_KEY_SERVER);
    setDbConfig({
      host: "localhost",
      port: "5432",
      database: "wireguard_manager",
      username: "wgadmin",
      password: "",
      useLocalDb: false,
    });
    setServerConfig({
      apiUrl: "",
      serverToken: "",
      wgEndpoint: "",
      wgPort: "51820",
      wgPublicKey: "",
    });
    setConnectionStatus("idle");
    toast.success("Configuration cleared");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-primary">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <Shield className="h-6 w-6 text-primary" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">Settings</h1>
                  <p className="text-xs text-muted-foreground">Configure database and server connections</p>
                </div>
              </div>
            </div>
            <ConnectionStatusIndicator />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="database" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
            <TabsTrigger value="database" className="gap-2">
              <Database className="h-4 w-4" />
              Database
            </TabsTrigger>
            <TabsTrigger value="server" className="gap-2">
              <Server className="h-4 w-4" />
              Server
            </TabsTrigger>
          </TabsList>

          <TabsContent value="database" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  Database Configuration
                </CardTitle>
                <CardDescription>
                  Configure connection to your local PostgreSQL database on the WireGuard server
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Use Local Database</Label>
                    <p className="text-sm text-muted-foreground">
                      Connect to a local PostgreSQL database instead of cloud
                    </p>
                  </div>
                  <Switch
                    checked={dbConfig.useLocalDb}
                    onCheckedChange={(checked) => setDbConfig({ ...dbConfig, useLocalDb: checked })}
                  />
                </div>

                {dbConfig.useLocalDb && (
                  <div className="grid gap-4 md:grid-cols-2 animate-fade-in">
                    <div className="space-y-2">
                      <Label htmlFor="db-host">Host</Label>
                      <Input
                        id="db-host"
                        placeholder="localhost or server IP"
                        value={dbConfig.host}
                        onChange={(e) => setDbConfig({ ...dbConfig, host: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="db-port">Port</Label>
                      <Input
                        id="db-port"
                        placeholder="5432"
                        value={dbConfig.port}
                        onChange={(e) => setDbConfig({ ...dbConfig, port: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="db-name">Database Name</Label>
                      <Input
                        id="db-name"
                        placeholder="wireguard_manager"
                        value={dbConfig.database}
                        onChange={(e) => setDbConfig({ ...dbConfig, database: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="db-user">Username</Label>
                      <Input
                        id="db-user"
                        placeholder="wgadmin"
                        value={dbConfig.username}
                        onChange={(e) => setDbConfig({ ...dbConfig, username: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                      <Label htmlFor="db-password">Password</Label>
                      <Input
                        id="db-password"
                        type="password"
                        placeholder="••••••••"
                        value={dbConfig.password}
                        onChange={(e) => setDbConfig({ ...dbConfig, password: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-border bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Environment Variables</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    These values should be in your server's config.env file:
                  </p>
                  <pre className="text-xs bg-background p-3 rounded-md border border-border overflow-x-auto font-mono">
{`VITE_LOCAL_DB_HOST=${dbConfig.host}
VITE_LOCAL_DB_PORT=${dbConfig.port}
VITE_LOCAL_DB_NAME=${dbConfig.database}
VITE_LOCAL_DB_USER=${dbConfig.username}
VITE_LOCAL_DB_PASSWORD=<your_password>`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="server" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-primary" />
                  Server Configuration
                </CardTitle>
                <CardDescription>
                  Configure connection to your WireGuard server API
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-url">API URL</Label>
                  <Input
                    id="api-url"
                    placeholder="http://your-server.com/api or https://your-server.com/api"
                    value={serverConfig.apiUrl}
                    onChange={(e) => setServerConfig({ ...serverConfig, apiUrl: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    The URL of your WireGuard server API (from wg-manager frontend command)
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="server-token">Server Token</Label>
                  <Input
                    id="server-token"
                    type="password"
                    placeholder="Your server authentication token"
                    value={serverConfig.serverToken}
                    onChange={(e) => setServerConfig({ ...serverConfig, serverToken: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    The SERVER_TOKEN from your installation (run wg-manager frontend on server)
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="wg-endpoint">WireGuard Endpoint</Label>
                    <Input
                      id="wg-endpoint"
                      placeholder="vpn.example.com"
                      value={serverConfig.wgEndpoint}
                      onChange={(e) => setServerConfig({ ...serverConfig, wgEndpoint: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wg-port">WireGuard Port</Label>
                    <Input
                      id="wg-port"
                      placeholder="51820"
                      value={serverConfig.wgPort}
                      onChange={(e) => setServerConfig({ ...serverConfig, wgPort: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wg-pubkey">Server Public Key</Label>
                  <Input
                    id="wg-pubkey"
                    placeholder="Server WireGuard public key"
                    value={serverConfig.wgPublicKey}
                    onChange={(e) => setServerConfig({ ...serverConfig, wgPublicKey: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    className="gap-2"
                  >
                    {testingConnection ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : connectionStatus === "success" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : connectionStatus === "error" ? (
                      <X className="h-4 w-4 text-destructive" />
                    ) : (
                      <TestTube className="h-4 w-4" />
                    )}
                    Test Connection
                  </Button>
                  {connectionStatus === "success" && (
                    <span className="text-sm text-success">Connected!</span>
                  )}
                  {connectionStatus === "error" && (
                    <span className="text-sm text-destructive">Failed</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <Button variant="outline" onClick={handleClearConfig}>
            Clear Configuration
          </Button>
          <Button onClick={handleSaveConfig} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Configuration
          </Button>
        </div>

        {/* Help Section */}
        <Card className="mt-8 bg-muted/30">
          <CardHeader>
            <CardTitle className="text-base">Quick Setup Guide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-1">1. Install WireGuard on your server</h4>
              <pre className="bg-background p-2 rounded text-xs font-mono">
                curl -sSL https://your-app.lovable.app/install-wireguard.sh | sudo bash
              </pre>
            </div>
            <div>
              <h4 className="font-medium mb-1">2. Get frontend configuration</h4>
              <pre className="bg-background p-2 rounded text-xs font-mono">
                wg-manager frontend
              </pre>
            </div>
            <div>
              <h4 className="font-medium mb-1">3. Copy the values shown above into this settings page</h4>
              <p className="text-muted-foreground">
                The command will display all the configuration values you need to connect this dashboard to your server.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

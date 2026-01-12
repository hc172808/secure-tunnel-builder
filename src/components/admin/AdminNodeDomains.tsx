import { useState, useEffect } from "react";
import { Globe, RefreshCw, Save, Server, Network, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface NodeDomainSettings {
  enabled: boolean;
  baseDomain: string;
  ipRangeStart: string;
  ipRangeEnd: string;
}

interface PeerWithDomain {
  id: string;
  name: string;
  subdomain: string | null;
  hostname: string | null;
  allowed_ips: string;
  status: string;
}

export function AdminNodeDomains() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NodeDomainSettings>({
    enabled: false,
    baseDomain: "",
    ipRangeStart: "10.0.0.2",
    ipRangeEnd: "10.0.0.254",
  });
  const [peers, setPeers] = useState<PeerWithDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newSubdomain, setNewSubdomain] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSettings();
    fetchPeers();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("server_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [
          "node_domain_enabled",
          "node_base_domain",
          "node_ip_range_start",
          "node_ip_range_end",
        ]);

      if (error) throw error;

      const newSettings: Partial<NodeDomainSettings> = {};
      data?.forEach((row) => {
        switch (row.setting_key) {
          case "node_domain_enabled":
            newSettings.enabled = row.setting_value === "true";
            break;
          case "node_base_domain":
            newSettings.baseDomain = row.setting_value;
            break;
          case "node_ip_range_start":
            newSettings.ipRangeStart = row.setting_value;
            break;
          case "node_ip_range_end":
            newSettings.ipRangeEnd = row.setting_value;
            break;
        }
      });

      setSettings((prev) => ({ ...prev, ...newSettings }));
    } catch (error) {
      console.error("Error fetching node domain settings:", error);
      toast.error("Failed to load node domain settings");
    } finally {
      setLoading(false);
    }
  };

  const fetchPeers = async () => {
    try {
      const { data, error } = await supabase
        .from("wireguard_peers")
        .select("id, name, subdomain, hostname, allowed_ips, status")
        .order("name");

      if (error) throw error;
      setPeers(data || []);
    } catch (error) {
      console.error("Error fetching peers:", error);
    }
  };

  const saveSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase
      .from("server_settings")
      .select("id")
      .eq("setting_key", key)
      .single();

    if (existing) {
      await supabase
        .from("server_settings")
        .update({ setting_value: value, updated_by: user?.id })
        .eq("setting_key", key);
    } else {
      await supabase.from("server_settings").insert({
        setting_key: key,
        setting_value: value,
        description: `Node domain ${key.replace("node_", "")} setting`,
        updated_by: user?.id,
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        saveSetting("node_domain_enabled", settings.enabled.toString()),
        saveSetting("node_base_domain", settings.baseDomain),
        saveSetting("node_ip_range_start", settings.ipRangeStart),
        saveSetting("node_ip_range_end", settings.ipRangeEnd),
      ]);

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "UPDATE",
        resource_type: "node_domain_settings",
        details: { baseDomain: settings.baseDomain, enabled: settings.enabled },
      });

      toast.success("Node domain settings saved successfully");
    } catch (error) {
      console.error("Error saving node domain settings:", error);
      toast.error("Failed to save node domain settings");
    } finally {
      setSaving(false);
    }
  };

  const assignSubdomain = async (peerId: string) => {
    const subdomain = newSubdomain[peerId];
    if (!subdomain) {
      toast.error("Please enter a subdomain");
      return;
    }

    if (!settings.baseDomain) {
      toast.error("Please configure a base domain first");
      return;
    }

    try {
      const hostname = `${subdomain}.${settings.baseDomain}`;

      const { error } = await supabase
        .from("wireguard_peers")
        .update({ subdomain, hostname })
        .eq("id", peerId);

      if (error) throw error;

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "ASSIGN_SUBDOMAIN",
        resource_type: "peer",
        resource_id: peerId,
        details: { subdomain, hostname },
      });

      toast.success(`Subdomain ${hostname} assigned`);
      fetchPeers();
      setNewSubdomain((prev) => ({ ...prev, [peerId]: "" }));
    } catch (error) {
      console.error("Error assigning subdomain:", error);
      toast.error("Failed to assign subdomain");
    }
  };

  const removeSubdomain = async (peerId: string) => {
    try {
      const { error } = await supabase
        .from("wireguard_peers")
        .update({ subdomain: null, hostname: null })
        .eq("id", peerId);

      if (error) throw error;

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "REMOVE_SUBDOMAIN",
        resource_type: "peer",
        resource_id: peerId,
      });

      toast.success("Subdomain removed");
      fetchPeers();
    } catch (error) {
      console.error("Error removing subdomain:", error);
      toast.error("Failed to remove subdomain");
    }
  };

  const generateSubdomainFromName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const autoAssignSubdomain = async (peer: PeerWithDomain) => {
    if (!settings.baseDomain) {
      toast.error("Please configure a base domain first");
      return;
    }

    const subdomain = generateSubdomainFromName(peer.name);
    const hostname = `${subdomain}.${settings.baseDomain}`;

    try {
      const { error } = await supabase
        .from("wireguard_peers")
        .update({ subdomain, hostname })
        .eq("id", peer.id);

      if (error) throw error;

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "AUTO_ASSIGN_SUBDOMAIN",
        resource_type: "peer",
        resource_id: peer.id,
        details: { subdomain, hostname },
      });

      toast.success(`Auto-assigned ${hostname}`);
      fetchPeers();
    } catch (error) {
      console.error("Error auto-assigning subdomain:", error);
      toast.error("Failed to auto-assign subdomain");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-6 w-6 text-primary" />
              <div>
                <CardTitle>Node Domain Management</CardTitle>
                <CardDescription>
                  Assign subdomains to nodes for easy identification and DNS resolution
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="node-domain-enabled">Enable</Label>
              <Switch
                id="node-domain-enabled"
                checked={settings.enabled}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="base-domain">Base Domain</Label>
              <Input
                id="base-domain"
                placeholder="nodes.yourdomain.com"
                value={settings.baseDomain}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, baseDomain: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Subdomains will be created under this domain (e.g., peer1.nodes.yourdomain.com)
              </p>
            </div>
            <div className="space-y-2">
              <Label>IP Range for Nodes</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="10.0.0.2"
                  value={settings.ipRangeStart}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ipRangeStart: e.target.value }))
                  }
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  placeholder="10.0.0.254"
                  value={settings.ipRangeEnd}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ipRangeEnd: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Peer Subdomain Assignments */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Server className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>Peer Subdomain Assignments</CardTitle>
              <CardDescription>
                Assign custom subdomains to each peer for DNS resolution
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Peer Name</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {peers.map((peer) => (
                <TableRow key={peer.id}>
                  <TableCell className="font-medium">{peer.name}</TableCell>
                  <TableCell className="font-mono text-sm">{peer.allowed_ips}</TableCell>
                  <TableCell>
                    <Badge variant={peer.status === "connected" ? "default" : "secondary"}>
                      {peer.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {peer.hostname ? (
                      <div className="flex items-center gap-2">
                        <Network className="h-4 w-4 text-success" />
                        <span className="font-mono text-sm">{peer.hostname}</span>
                      </div>
                    ) : (
                <span className="text-muted-foreground text-sm">Not assigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {peer.hostname ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSubdomain(peer.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Input
                              placeholder="subdomain"
                              value={newSubdomain[peer.id] || ""}
                              onChange={(e) =>
                                setNewSubdomain((prev) => ({
                                  ...prev,
                                  [peer.id]: e.target.value,
                                }))
                              }
                              className="w-24 h-8"
                            />
                            {settings.baseDomain && (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                .{settings.baseDomain}
                              </span>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => assignSubdomain(peer.id)}
                            disabled={!settings.baseDomain}
                            title={settings.baseDomain ? "Assign subdomain" : "Configure base domain first"}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => autoAssignSubdomain(peer)}
                            disabled={!settings.baseDomain}
                            title={settings.baseDomain ? "Auto-assign from name" : "Configure base domain first"}
                          >
                            <Network className="h-4 w-4" />
                          </Button>
                        </div>
                        {!settings.baseDomain && (
                          <span className="text-xs text-warning">Set base domain first</span>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {peers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No peers configured
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">DNS Setup Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            1. Set up a base domain (e.g., nodes.yourdomain.com) pointing to your WireGuard server
          </p>
          <p>2. Add a wildcard DNS record: *.nodes.yourdomain.com → Your Server IP</p>
          <p>3. Enable the feature and assign subdomains to each peer</p>
          <p>4. Peers can then be accessed via their hostname (e.g., laptop.nodes.yourdomain.com)</p>
          <p className="text-warning">
            Note: This requires proper DNS configuration on your domain registrar
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

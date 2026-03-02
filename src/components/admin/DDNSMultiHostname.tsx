import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, RefreshCw, Globe, CheckCircle, XCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface HostnameEntry {
  id: string;
  hostname: string;
  provider: string;
  credentials?: Record<string, string>;
  lastUpdate: string | null;
  lastIP: string | null;
  lastStatus: "success" | "failed" | "pending" | null;
}

interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
  helpText?: string;
}

const PROVIDER_OPTIONS: { id: string; name: string; fields: ProviderField[] }[] = [
  {
    id: "noip",
    name: "No-IP",
    fields: [
      { key: "username", label: "Username", placeholder: "your@email.com", required: true },
      { key: "password", label: "Password", placeholder: "••••••••", secret: true, required: true },
    ],
  },
  {
    id: "duckdns",
    name: "DuckDNS",
    fields: [
      { key: "token", label: "Token", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", secret: true, required: true, helpText: "Found at duckdns.org after login" },
    ],
  },
  {
    id: "dynu",
    name: "Dynu",
    fields: [
      { key: "username", label: "Username", placeholder: "your@email.com", required: true },
      { key: "password", label: "Password / IP Update Password", placeholder: "••••••••", secret: true, required: true },
    ],
  },
  {
    id: "freedns",
    name: "FreeDNS",
    fields: [
      { key: "update_key", label: "Update Key", placeholder: "alphanumeric update key", secret: true, required: true, helpText: "Found in FreeDNS direct URL" },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    fields: [
      { key: "api_token", label: "API Token", placeholder: "CF API token with DNS edit permissions", secret: true, required: true },
      { key: "zone_id", label: "Zone ID", placeholder: "32-char hex zone ID", required: true, helpText: "Found on domain overview page in Cloudflare dashboard" },
    ],
  },
  {
    id: "custom",
    name: "Custom",
    fields: [
      { key: "update_url", label: "Update URL", placeholder: "https://provider.com/update?ip={ip}&host=...", required: true, helpText: "Use {ip} as placeholder for current IP" },
    ],
  },
];

export function DDNSMultiHostname() {
  const { user } = useAuth();
  const [hostnames, setHostnames] = useState<HostnameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [newHostname, setNewHostname] = useState("");
  const [newProvider, setNewProvider] = useState("noip");
  const [newCredentials, setNewCredentials] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const selectedProviderConfig = PROVIDER_OPTIONS.find((p) => p.id === newProvider);

  const fetchHostnames = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("server_settings")
        .select("setting_key, setting_value")
        .eq("setting_key", "ddns_hostnames");

      if (error) throw error;

      if (data && data.length > 0 && data[0].setting_value) {
        try {
          const parsed = JSON.parse(data[0].setting_value);
          setHostnames(Array.isArray(parsed) ? parsed : []);
        } catch {
          setHostnames([]);
        }
      }
    } catch (error) {
      console.error("Error fetching hostnames:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHostnames();
  }, [fetchHostnames]);

  // Reset credentials when provider changes
  useEffect(() => {
    setNewCredentials({});
    setShowSecrets({});
  }, [newProvider]);

  const saveHostnames = useCallback(
    async (entries: HostnameEntry[]) => {
      const value = JSON.stringify(entries);
      const { data: existing } = await supabase
        .from("server_settings")
        .select("id")
        .eq("setting_key", "ddns_hostnames")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("server_settings")
          .update({ setting_value: value, updated_by: user?.id })
          .eq("setting_key", "ddns_hostnames");
      } else {
        await supabase.from("server_settings").insert({
          setting_key: "ddns_hostnames",
          setting_value: value,
          description: "Additional DDNS hostnames for simultaneous updates",
          updated_by: user?.id,
        });
      }
    },
    [user?.id]
  );

  const validateCredentials = (): boolean => {
    if (!selectedProviderConfig) return true;
    for (const field of selectedProviderConfig.fields) {
      if (field.required && !newCredentials[field.key]?.trim()) {
        toast.error(`${field.label} is required for ${selectedProviderConfig.name}`);
        return false;
      }
    }
    return true;
  };

  const addHostname = async () => {
    if (!newHostname.trim()) {
      toast.error("Please enter a hostname");
      return;
    }
    if (hostnames.some((h) => h.hostname === newHostname.trim())) {
      toast.error("Hostname already exists");
      return;
    }
    if (!validateCredentials()) return;

    const entry: HostnameEntry = {
      id: crypto.randomUUID(),
      hostname: newHostname.trim(),
      provider: newProvider,
      credentials: { ...newCredentials },
      lastUpdate: null,
      lastIP: null,
      lastStatus: null,
    };

    const updated = [...hostnames, entry];
    setHostnames(updated);
    await saveHostnames(updated);
    setNewHostname("");
    setNewCredentials({});
    toast.success(`Added ${entry.hostname}`);
  };

  const removeHostname = async (id: string) => {
    const updated = hostnames.filter((h) => h.id !== id);
    setHostnames(updated);
    await saveHostnames(updated);
    toast.success("Hostname removed");
  };

  const updateSingleHostname = async (entry: HostnameEntry) => {
    setUpdating(entry.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ddns-update/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            provider: entry.provider,
            hostname: entry.hostname,
            credentials: entry.credentials,
          }),
        }
      );

      const result = await response.json();
      const success = response.ok && result.success;

      const updated = hostnames.map((h) =>
        h.id === entry.id
          ? {
              ...h,
              lastUpdate: new Date().toISOString(),
              lastIP: result.ip || h.lastIP,
              lastStatus: success ? ("success" as const) : ("failed" as const),
            }
          : h
      );
      setHostnames(updated);
      await saveHostnames(updated);

      if (success) {
        toast.success(`Updated ${entry.hostname} → ${result.ip}`);
      } else {
        toast.error(`Failed to update ${entry.hostname}: ${result.message || "Unknown error"}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to update ${entry.hostname}: ${msg}`);

      const updated = hostnames.map((h) =>
        h.id === entry.id ? { ...h, lastStatus: "failed" as const } : h
      );
      setHostnames(updated);
      await saveHostnames(updated);
    } finally {
      setUpdating(null);
    }
  };

  const updateAllHostnames = async () => {
    if (hostnames.length === 0) return;
    setUpdatingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const entry of hostnames) {
      try {
        await updateSingleHostname(entry);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setUpdatingAll(false);
    if (failCount === 0) {
      toast.success(`All ${successCount} hostnames updated successfully`);
    } else {
      toast.warning(`${successCount} succeeded, ${failCount} failed`);
    }
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const maskValue = (value: string) => {
    if (value.length <= 6) return "••••••";
    return value.slice(0, 3) + "•••" + value.slice(-3);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Multiple Hostnames</CardTitle>
              <CardDescription>
                Manage additional hostnames with provider-specific credentials
              </CardDescription>
            </div>
          </div>
          {hostnames.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={updateAllHostnames}
              disabled={updatingAll}
            >
              {updatingAll ? (
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Update All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new hostname */}
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Hostname</Label>
              <Input
                placeholder={
                  newProvider === "duckdns"
                    ? "yourname.duckdns.org"
                    : newProvider === "cloudflare"
                    ? "vpn.yourdomain.com"
                    : "yourname.ddns.net"
                }
                value={newHostname}
                onChange={(e) => setNewHostname(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addHostname()}
              />
            </div>
            <div className="w-[140px] space-y-1">
              <Label className="text-xs">Provider</Label>
              <Select value={newProvider} onValueChange={setNewProvider}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Provider-specific credential fields */}
          {selectedProviderConfig && selectedProviderConfig.fields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {selectedProviderConfig.fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-xs">
                    {field.label}
                    {field.required && <span className="text-destructive ml-0.5">*</span>}
                  </Label>
                  <div className="relative">
                    <Input
                      type={field.secret && !showSecrets[field.key] ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={newCredentials[field.key] || ""}
                      onChange={(e) =>
                        setNewCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="pr-8"
                    />
                    {field.secret && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleSecret(field.key)}
                      >
                        {showSecrets[field.key] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                  {field.helpText && (
                    <p className="text-[10px] text-muted-foreground">{field.helpText}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <Button size="sm" className="w-full" onClick={addHostname}>
            <Plus className="mr-2 h-4 w-4" />
            Add Hostname
          </Button>
        </div>

        {/* Hostname list */}
        {hostnames.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No additional hostnames configured. Add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {hostnames.map((entry) => {
              const providerConfig = PROVIDER_OPTIONS.find((p) => p.id === entry.provider);
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium font-mono truncate">
                        {entry.hostname}
                      </span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {providerConfig?.name || entry.provider}
                      </Badge>
                      {entry.credentials && Object.keys(entry.credentials).length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {Object.keys(entry.credentials).length} credential{Object.keys(entry.credentials).length > 1 ? "s" : ""}
                        </Badge>
                      )}
                      {entry.lastStatus === "success" && (
                        <CheckCircle className="h-3.5 w-3.5 text-success flex-shrink-0" />
                      )}
                      {entry.lastStatus === "failed" && (
                        <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                      )}
                      {entry.lastStatus === null && (
                        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                    {entry.lastUpdate && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Last: {new Date(entry.lastUpdate).toLocaleString()}
                        {entry.lastIP && <span className="font-mono ml-2">{entry.lastIP}</span>}
                      </div>
                    )}
                    {entry.credentials && Object.keys(entry.credentials).length > 0 && (
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {Object.entries(entry.credentials).map(([key, val]) => (
                          <span key={key} className="text-[10px] text-muted-foreground">
                            {key}: <span className="font-mono">{maskValue(val)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => updateSingleHostname(entry)}
                    disabled={updating === entry.id}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${updating === entry.id ? "animate-spin" : ""}`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => removeHostname(entry.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

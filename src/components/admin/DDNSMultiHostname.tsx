import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, RefreshCw, Globe, CheckCircle, XCircle, AlertCircle } from "lucide-react";
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
  lastUpdate: string | null;
  lastIP: string | null;
  lastStatus: "success" | "failed" | "pending" | null;
}

const PROVIDER_OPTIONS = [
  { id: "noip", name: "No-IP" },
  { id: "duckdns", name: "DuckDNS" },
  { id: "dynu", name: "Dynu" },
  { id: "freedns", name: "FreeDNS" },
  { id: "cloudflare", name: "Cloudflare" },
  { id: "custom", name: "Custom" },
];

export function DDNSMultiHostname() {
  const { user } = useAuth();
  const [hostnames, setHostnames] = useState<HostnameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [newHostname, setNewHostname] = useState("");
  const [newProvider, setNewProvider] = useState("noip");

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

  const addHostname = async () => {
    if (!newHostname.trim()) {
      toast.error("Please enter a hostname");
      return;
    }
    if (hostnames.some((h) => h.hostname === newHostname.trim())) {
      toast.error("Hostname already exists");
      return;
    }

    const entry: HostnameEntry = {
      id: crypto.randomUUID(),
      hostname: newHostname.trim(),
      provider: newProvider,
      lastUpdate: null,
      lastIP: null,
      lastStatus: null,
    };

    const updated = [...hostnames, entry];
    setHostnames(updated);
    await saveHostnames(updated);
    setNewHostname("");
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
                Manage additional hostnames to update simultaneously
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
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Hostname</Label>
            <Input
              placeholder="yourname.ddns.net"
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
          <Button size="icon" className="h-9 w-9" onClick={addHostname}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Hostname list */}
        {hostnames.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No additional hostnames configured. Add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {hostnames.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium font-mono truncate">
                      {entry.hostname}
                    </span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {PROVIDER_OPTIONS.find((p) => p.id === entry.provider)?.name || entry.provider}
                    </Badge>
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

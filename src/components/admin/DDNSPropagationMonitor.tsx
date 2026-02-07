import { useState, useEffect, useCallback } from "react";
import { Globe, CheckCircle, XCircle, AlertTriangle, RefreshCw, Radio } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PropagationResult {
  hostname: string;
  resolvedIp: string | null;
  expectedIp: string | null;
  propagated: boolean;
  checkedAt: Date;
  error?: string;
}

export function DDNSPropagationMonitor() {
  const [results, setResults] = useState<PropagationResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [autoCheck, setAutoCheck] = useState(false);
  const [hostname, setHostname] = useState("");
  const [expectedIp, setExpectedIp] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchDDNSInfo = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("server_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["noip_hostname", "noip_last_ip", "ddns_hostnames"]);

      const config: Record<string, string> = {};
      data?.forEach((r) => {
        config[r.setting_key] = r.setting_value;
      });

      setHostname(config.noip_hostname || "");
      setExpectedIp(config.noip_last_ip || "");
    } catch (err) {
      console.error("Error fetching DDNS info:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDDNSInfo();
  }, [fetchDDNSInfo]);

  // Auto-check every 2 minutes when enabled
  useEffect(() => {
    if (!autoCheck || !hostname) return;
    const interval = setInterval(() => {
      runPropagationCheck();
    }, 120000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, hostname]);

  const runPropagationCheck = async () => {
    if (!hostname) {
      toast.error("No DDNS hostname configured");
      return;
    }

    setChecking(true);
    try {
      // Collect all hostnames to check
      const hostnames = [hostname];

      const { data: extraData } = await supabase
        .from("server_settings")
        .select("setting_value")
        .eq("setting_key", "ddns_hostnames")
        .maybeSingle();

      if (extraData?.setting_value) {
        try {
          const extras = JSON.parse(extraData.setting_value);
          if (Array.isArray(extras)) {
            extras.forEach((e: { hostname?: string }) => {
              if (e.hostname) hostnames.push(e.hostname);
            });
          }
        } catch {
          // ignore
        }
      }

      const newResults: PropagationResult[] = [];

      for (const hn of hostnames) {
        try {
          const { data, error } = await supabase.functions.invoke("dns-validate", {
            body: { hostname: hn, expectedIp: expectedIp || undefined },
          });

          if (error) {
            newResults.push({
              hostname: hn,
              resolvedIp: null,
              expectedIp,
              propagated: false,
              checkedAt: new Date(),
              error: error.message,
            });
          } else {
            newResults.push({
              hostname: hn,
              resolvedIp: data.resolvedIp || null,
              expectedIp,
              propagated: data.valid === true,
              checkedAt: new Date(),
              error: data.error,
            });
          }
        } catch (err) {
          newResults.push({
            hostname: hn,
            resolvedIp: null,
            expectedIp,
            propagated: false,
            checkedAt: new Date(),
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      setResults(newResults);

      const allPropagated = newResults.every((r) => r.propagated);
      const nonePropagated = newResults.every((r) => !r.propagated);

      if (allPropagated) {
        toast.success("All DNS records propagated successfully!");
      } else if (nonePropagated) {
        toast.error("DNS records not yet propagated");
      } else {
        toast.info("Some DNS records still propagating");
      }
    } catch (err) {
      console.error("Propagation check error:", err);
      toast.error("Failed to run propagation check");
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!hostname) return null;

  const allGood = results.length > 0 && results.every((r) => r.propagated);
  const hasFailures = results.some((r) => !r.propagated);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">DNS Propagation Monitor</CardTitle>
              <CardDescription>
                Automatically verify DNS records have propagated globally after updates
              </CardDescription>
            </div>
          </div>
          {results.length > 0 && (
            <Badge
              variant={allGood ? "default" : "destructive"}
              className={allGood ? "bg-success" : ""}
            >
              {allGood ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Propagated
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Pending
                </>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="auto-propagation"
                checked={autoCheck}
                onCheckedChange={setAutoCheck}
              />
              <Label htmlFor="auto-propagation" className="text-sm">
                Auto-check every 2 min
              </Label>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={runPropagationCheck}
            disabled={checking}
          >
            {checking ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Globe className="h-4 w-4 mr-1" />
            )}
            Check Now
          </Button>
        </div>

        {/* Progress */}
        {checking && (
          <div className="space-y-1">
            <Progress value={undefined} className="h-1" />
            <p className="text-xs text-muted-foreground text-center">
              Checking DNS propagation...
            </p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((result, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  result.propagated
                    ? "border-success/30 bg-success/5"
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <div className="flex items-center gap-2">
                  {result.propagated ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <div>
                    <p className="text-sm font-mono font-medium">{result.hostname}</p>
                    <p className="text-xs text-muted-foreground">
                      {result.resolvedIp
                        ? `Resolved: ${result.resolvedIp}`
                        : result.error || "Not resolved"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge
                    variant="outline"
                    className={
                      result.propagated
                        ? "bg-success/20 text-success border-success/30"
                        : "bg-destructive/20 text-destructive border-destructive/30"
                    }
                  >
                    {result.propagated ? "Propagated" : "Pending"}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.checkedAt.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !checking && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Click "Check Now" to verify DNS propagation for your DDNS hostnames
          </p>
        )}
      </CardContent>
    </Card>
  );
}

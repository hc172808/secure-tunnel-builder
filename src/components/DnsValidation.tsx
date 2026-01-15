import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Globe, Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DnsResult {
  peer_id: string;
  peer_name: string;
  hostname: string;
  valid: boolean;
  resolved_ips: string[];
  expected_ip: string | null;
  error: string | null;
  response_time_ms: number;
}

interface ValidationResponse {
  expected_ip: string | null;
  total: number;
  valid_count: number;
  invalid_count: number;
  results: DnsResult[];
}

interface SingleCheckResult {
  hostname: string;
  valid: boolean;
  resolved_ips: string[];
  expected_ip: string | null;
  error: string | null;
  response_time_ms: number;
}

interface PreCheckResult {
  hostname: string;
  wildcard_configured: boolean;
  resolved_ips: string[];
  expected_ip: string | null;
  valid: boolean;
  error: string | null;
  response_time_ms: number;
  recommendation: string;
}

export function DnsValidation() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ValidationResponse | null>(null);
  const [singleHostname, setSingleHostname] = useState("");
  const [singleResult, setSingleResult] = useState<SingleCheckResult | null>(null);
  const [checkingHostname, setCheckingHostname] = useState(false);

  const validateAllDns = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to validate DNS");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dns-validate/check-all`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to validate DNS");
      }

      const data = await response.json();
      setResults(data);
      
      if (data.invalid_count > 0) {
        toast.warning(`${data.invalid_count} DNS record(s) need attention`);
      } else if (data.valid_count > 0) {
        toast.success("All DNS records are valid!");
      }
    } catch (error) {
      console.error("DNS validation error:", error);
      toast.error(error instanceof Error ? error.message : "DNS validation failed");
    } finally {
      setLoading(false);
    }
  };

  const checkSingleHostname = async () => {
    if (!singleHostname.trim()) {
      toast.error("Please enter a hostname");
      return;
    }

    setCheckingHostname(true);
    setSingleResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to validate DNS");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dns-validate/check`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ hostname: singleHostname.trim() }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to check DNS");
      }

      const data = await response.json();
      setSingleResult(data);

      if (data.valid) {
        toast.success(`DNS resolved: ${data.resolved_ips.join(", ")}`);
      } else {
        toast.error(data.error || "DNS resolution failed");
      }
    } catch (error) {
      console.error("DNS check error:", error);
      toast.error(error instanceof Error ? error.message : "DNS check failed");
    } finally {
      setCheckingHostname(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Single Hostname Check */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Search className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Quick DNS Check</CardTitle>
              <CardDescription>
                Test if a hostname resolves correctly
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="hostname.example.com"
              value={singleHostname}
              onChange={(e) => setSingleHostname(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkSingleHostname()}
            />
            <Button onClick={checkSingleHostname} disabled={checkingHostname}>
              {checkingHostname ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>

          {singleResult && (
            <div className="mt-4 p-4 rounded-lg border bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                {singleResult.valid ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <span className="font-medium">{singleResult.hostname}</span>
                <Badge variant={singleResult.valid ? "default" : "destructive"}>
                  {singleResult.valid ? "Valid" : "Invalid"}
                </Badge>
              </div>
              
              {singleResult.resolved_ips.length > 0 && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Resolved IPs:</span>{" "}
                  <span className="font-mono">{singleResult.resolved_ips.join(", ")}</span>
                </p>
              )}
              
              {singleResult.error && (
                <p className="text-sm text-destructive mt-1">{singleResult.error}</p>
              )}
              
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Response time: {singleResult.response_time_ms}ms
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Validation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Peer DNS Validation</CardTitle>
                <CardDescription>
                  Validate DNS records for all peers with assigned subdomains
                </CardDescription>
              </div>
            </div>
            <Button onClick={validateAllDns} disabled={loading}>
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Validate All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {results && (
            <>
              <div className="flex gap-4 mb-4">
                <Badge variant="outline" className="gap-1">
                  Expected IP: <span className="font-mono">{results.expected_ip || "N/A"}</span>
                </Badge>
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {results.valid_count} Valid
                </Badge>
                {results.invalid_count > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    {results.invalid_count} Invalid
                  </Badge>
                )}
              </div>

              {results.results.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Peer</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Resolved IPs</TableHead>
                      <TableHead>Response Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.results.map((result) => (
                      <TableRow key={result.peer_id}>
                        <TableCell className="font-medium">{result.peer_name}</TableCell>
                        <TableCell className="font-mono text-sm">{result.hostname}</TableCell>
                        <TableCell>
                          {result.valid ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Valid
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              Invalid
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.resolved_ips.length > 0 ? (
                            <span className="font-mono text-sm">
                              {result.resolved_ips.join(", ")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {result.error || "No records"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {result.response_time_ms}ms
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No peers have assigned subdomains</p>
                </div>
              )}
            </>
          )}

          {!results && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Click "Validate All" to check DNS records for all peer subdomains</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DNS Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Troubleshooting DNS Issues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>1. Wildcard DNS:</strong> Ensure you have a wildcard A record configured:
            <code className="ml-2 px-2 py-1 bg-muted rounded">*.yourdomain.com → Server IP</code>
          </p>
          <p>
            <strong>2. DNS Propagation:</strong> DNS changes can take up to 24-48 hours to propagate globally.
          </p>
          <p>
            <strong>3. TTL:</strong> If you recently changed DNS records, the old values may be cached. Check TTL settings.
          </p>
          <p>
            <strong>4. Verify with CLI:</strong>
            <code className="ml-2 px-2 py-1 bg-muted rounded">dig hostname.example.com</code> or
            <code className="ml-2 px-2 py-1 bg-muted rounded">nslookup hostname.example.com</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

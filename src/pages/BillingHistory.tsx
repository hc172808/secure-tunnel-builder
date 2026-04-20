import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, BarChart3, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BillingRecord {
  id: string;
  billing_period_start: string;
  billing_period_end: string;
  total_bytes: number;
  total_gb: number | null;
  amount_due: number;
  currency: string;
  status: string;
  created_at: string;
}

interface RateTier {
  id: string;
  name: string;
  min_gb: number;
  max_gb: number | null;
  rate_per_gb: number;
}

export default function BillingHistory() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    setFetching(true);
    const [recordsRes, tiersRes] = await Promise.all([
      supabase.from("usage_billing_records").select("*").eq("user_id", user!.id).order("billing_period_start", { ascending: false }),
      supabase.from("bandwidth_rate_tiers").select("*").eq("is_active", true).order("min_gb", { ascending: true }),
    ]);
    if (recordsRes.error) toast.error("Failed to load billing history");
    if (recordsRes.data) {
      setRecords(recordsRes.data.map(r => ({
        ...r,
        total_gb: r.total_gb ? Number(r.total_gb) : null,
        amount_due: Number(r.amount_due),
      })) as BillingRecord[]);
    }
    if (tiersRes.data) {
      setTiers(tiersRes.data.map(t => ({
        ...t,
        min_gb: Number(t.min_gb),
        max_gb: t.max_gb !== null ? Number(t.max_gb) : null,
        rate_per_gb: Number(t.rate_per_gb),
      })) as RateTier[]);
    }
    setFetching(false);
  };

  const tierForGb = (gb: number) => {
    return tiers.find(t => gb >= t.min_gb && (t.max_gb === null || gb <= t.max_gb));
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const totalSpent = records.reduce((sum, r) => sum + (r.status === "paid" ? r.amount_due : 0), 0);
  const totalPending = records.reduce((sum, r) => sum + (r.status === "pending" ? r.amount_due : 0), 0);

  if (loading || fetching) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <BarChart3 className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Billing History</h1>
            <p className="text-xs text-muted-foreground">Bandwidth usage and charges per period</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardDescription>Total Periods</CardDescription></CardHeader>
            <CardContent><p className="text-3xl font-bold text-foreground">{records.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Total Paid</CardDescription></CardHeader>
            <CardContent><p className="text-3xl font-bold text-success">{totalSpent.toFixed(2)} GYD</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Pending</CardDescription></CardHeader>
            <CardContent><p className="text-3xl font-bold text-warning">{totalPending.toFixed(2)} GYD</p></CardContent>
          </Card>
        </div>

        {tiers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Rate Tiers</CardTitle>
              <CardDescription>Current pricing structure for bandwidth usage</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {tiers.map(t => (
                  <Badge key={t.id} variant="outline" className="text-xs">
                    {t.name}: {t.min_gb}–{t.max_gb ?? "∞"} GB @ {t.rate_per_gb} GYD/GB
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> Period History</CardTitle>
            <CardDescription>Your bandwidth charges per billing period</CardDescription>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No billing records yet. Records appear here after the billing period ends.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Tier Applied</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => {
                    const gb = r.total_gb ?? r.total_bytes / (1024 ** 3);
                    const tier = tierForGb(gb);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">
                          {new Date(r.billing_period_start).toLocaleDateString()} – {new Date(r.billing_period_end).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          <p className="font-medium">{gb.toFixed(2)} GB</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(r.total_bytes)}</p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {tier ? (
                            <Badge variant="outline">{tier.name} • {tier.rate_per_gb} GYD/GB</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-semibold">{r.amount_due.toFixed(2)} {r.currency}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "paid" ? "default" : r.status === "pending" ? "secondary" : "destructive"}>
                            {r.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

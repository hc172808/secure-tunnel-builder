import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ChevronLeft, BarChart3, Calendar as CalendarIcon, Loader2, X, ChevronLeft as PrevIcon, ChevronRight as NextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

const PAGE_SIZES = [10, 25, 50];

export default function BillingHistory() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [fetching, setFetching] = useState(true);

  // Filters
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const filtered = useMemo(() => {
    return records.filter(r => {
      const start = new Date(r.billing_period_start);
      const end = new Date(r.billing_period_end);
      if (fromDate && end < fromDate) return false;
      if (toDate && start > toDate) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [records, fromDate, toDate, statusFilter]);

  useEffect(() => { setPage(1); }, [fromDate, toDate, statusFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRecords = filtered.slice((page - 1) * pageSize, page * pageSize);

  const tierForGb = (gb: number) => tiers.find(t => gb >= t.min_gb && (t.max_gb === null || gb <= t.max_gb));

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const totalSpent = filtered.reduce((sum, r) => sum + (r.status === "paid" ? r.amount_due : 0), 0);
  const totalPending = filtered.reduce((sum, r) => sum + (r.status === "pending" ? r.amount_due : 0), 0);
  const hasFilters = fromDate || toDate || statusFilter !== "all";

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
            <CardHeader className="pb-2"><CardDescription>Filtered Periods</CardDescription></CardHeader>
            <CardContent><p className="text-3xl font-bold text-foreground">{filtered.length}</p></CardContent>
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
            <CardTitle className="flex items-center gap-2"><CalendarIcon className="h-5 w-5" /> Period History</CardTitle>
            <CardDescription>Your bandwidth charges per billing period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">From</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !fromDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fromDate ? format(fromDate, "PP") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">To</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !toDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {toDate ? format(toDate, "PP") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={() => { setFromDate(undefined); setToDate(undefined); setStatusFilter("all"); }}>
                  <X className="mr-1 h-3 w-3" /> Clear
                </Button>
              )}
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {records.length === 0 ? "No billing records yet. Records appear here after the billing period ends." : "No records match your filters."}
              </p>
            ) : (
              <>
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
                    {pageRecords.map(r => {
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
                            {tier ? <Badge variant="outline">{tier.name} • {tier.rate_per_gb} GYD/GB</Badge> : <span className="text-xs text-muted-foreground">—</span>}
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

                {/* Pagination */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page:</span>
                    <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                      <SelectTrigger className="w-[80px] h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZES.map(s => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="ml-2">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                      <PrevIcon className="h-4 w-4" />
                    </Button>
                    <span className="text-sm px-2">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                      <NextIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

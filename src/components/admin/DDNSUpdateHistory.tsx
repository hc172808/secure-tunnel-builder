import { useState, useEffect, useCallback } from "react";
import { History, RefreshCw, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

interface DDNSLogEntry {
  id: string;
  created_at: string;
  action: string;
  details: {
    provider?: string;
    hostname?: string;
    ip?: string;
    response?: string;
    success?: boolean;
    auto?: boolean;
    error?: string;
  } | null;
}

export function DDNSUpdateHistory() {
  const [logs, setLogs] = useState<DDNSLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      // Get total count
      let countQuery = supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .in("action", ["DDNS_UPDATE", "DDNS_UPDATE_FAILED", "NOIP_UPDATE", "NOIP_UPDATE_FAILED"]);

      const { count } = await countQuery;
      setTotalCount(count || 0);

      // Get paginated data
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("audit_logs")
        .select("id, created_at, action, details")
        .in("action", ["DDNS_UPDATE", "DDNS_UPDATE_FAILED", "NOIP_UPDATE", "NOIP_UPDATE_FAILED"])
        .order("created_at", { ascending: false })
        .range(from, to);

      const { data, error } = await query;
      if (error) throw error;

      const parsed: DDNSLogEntry[] = (data || []).map((row) => {
        const d = row.details as Record<string, unknown> | null;
        return {
          id: row.id,
          created_at: row.created_at,
          action: row.action,
          details: d
            ? {
                provider: d.provider as string | undefined,
                hostname: d.hostname as string | undefined,
                ip: d.ip as string | undefined,
                response: d.response as string | undefined,
                success: d.success as boolean | undefined,
                auto: d.auto as boolean | undefined,
                error: d.error as string | undefined,
              }
            : null,
        };
      });

      // Client-side status filter
      if (statusFilter === "success") {
        setLogs(parsed.filter((l) => l.details?.success === true));
      } else if (statusFilter === "failed") {
        setLogs(parsed.filter((l) => l.details?.success === false || l.action.includes("FAILED")));
      } else {
        setLogs(parsed);
      }
    } catch (error) {
      console.error("Error fetching DDNS logs:", error);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, statusFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, pageSize]);

  const isSuccess = (entry: DDNSLogEntry) =>
    entry.details?.success === true || (!entry.action.includes("FAILED") && entry.details?.success !== false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Update History</CardTitle>
              <CardDescription>DDNS update attempts and results</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchLogs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No DDNS update history yet
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {logs.map((entry) => {
                const success = isSuccess(entry);
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="mt-0.5">
                      {success ? (
                        <CheckCircle className="h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">
                          {entry.details?.hostname || "Unknown host"}
                        </span>
                        {entry.details?.provider && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {entry.details.provider}
                          </Badge>
                        )}
                        {entry.details?.auto && (
                          <Badge variant="secondary" className="text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            Auto
                          </Badge>
                        )}
                        <Badge variant={success ? "default" : "destructive"} className="text-xs">
                          {success ? "Success" : "Failed"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {entry.details?.ip && (
                          <span className="font-mono">{entry.details.ip}</span>
                        )}
                        <span>
                          {entry.details?.response || entry.details?.error || "No details"}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Rows:</span>
                <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="w-[65px] h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

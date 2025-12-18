import { useState, useEffect } from "react";
import { History, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Json } from "@/integrations/supabase/types";

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Json;
  ip_address: string | null;
  created_at: string;
}

const actionColors: Record<string, string> = {
  CREATE: "bg-success/20 text-success",
  DELETE: "bg-destructive/20 text-destructive",
  UPDATE: "bg-warning/20 text-warning",
  GRANT_ADMIN: "bg-primary/20 text-primary",
  REVOKE_ADMIN: "bg-muted text-muted-foreground",
  LOGIN: "bg-success/20 text-success",
  LOGOUT: "bg-muted text-muted-foreground",
};

export function AdminAuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      toast.error("Failed to fetch audit logs");
      setLoading(false);
      return;
    }

    setLogs(data || []);
    setLoading(false);
  };

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.resource_type.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Audit Logs</h2>
          <p className="text-sm text-muted-foreground">
            Track all administrative actions
          </p>
        </div>
        <div className="relative w-64">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter logs..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="gradient-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Time</TableHead>
              <TableHead className="text-muted-foreground">Action</TableHead>
              <TableHead className="text-muted-foreground">Resource</TableHead>
              <TableHead className="text-muted-foreground">Details</TableHead>
              <TableHead className="text-muted-foreground">IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.map((log) => (
              <TableRow key={log.id} className="border-border">
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {new Date(log.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge className={actionColors[log.action] || "bg-muted"}>
                    {log.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-foreground">
                  {log.resource_type}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono max-w-[200px] truncate">
                  {log.details ? JSON.stringify(log.details) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {log.ip_address || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filteredLogs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No audit logs found</p>
        </div>
      )}
    </div>
  );
}

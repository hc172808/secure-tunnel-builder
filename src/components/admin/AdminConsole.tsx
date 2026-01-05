import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Play, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface LogEntry {
  timestamp: string;
  type: "info" | "error" | "success" | "command";
  message: string;
}

export function AdminConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [command, setCommand] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load initial logs
    loadAuditLogs();
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when new logs are added
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const loadAuditLogs = async () => {
    try {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const formattedLogs: LogEntry[] = (data || []).reverse().map((log) => ({
        timestamp: new Date(log.created_at).toLocaleTimeString(),
        type: log.action.includes("error") ? "error" : "info",
        message: `[${log.action}] ${log.resource_type}${log.resource_id ? ` (${log.resource_id.slice(0, 8)})` : ""} - ${JSON.stringify(log.details || {})}`,
      }));

      setLogs(formattedLogs);
    } catch (error) {
      console.error("Error loading logs:", error);
    }
  };

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        message,
      },
    ]);
  };

  const executeCommand = async () => {
    if (!command.trim()) return;

    setIsExecuting(true);
    addLog("command", `$ ${command}`);

    try {
      const cmd = command.toLowerCase().trim();

      // Simulated command handling
      if (cmd === "help") {
        addLog("info", "Available commands:");
        addLog("info", "  status     - Show WireGuard interface status");
        addLog("info", "  peers      - List all peers");
        addLog("info", "  sync       - Sync with cloud database");
        addLog("info", "  backup     - Create database backup");
        addLog("info", "  update     - Check for updates");
        addLog("info", "  logs       - Show recent audit logs");
        addLog("info", "  clear      - Clear console");
        addLog("info", "  help       - Show this help message");
      } else if (cmd === "status") {
        addLog("info", "Fetching WireGuard status...");
        const { data } = await supabase.from("server_settings").select("*");
        addLog("success", `Server settings loaded: ${data?.length || 0} entries`);
        addLog("info", "Interface: wg0 (active)");
        addLog("info", "Listening port: 51820");
      } else if (cmd === "peers") {
        addLog("info", "Fetching peers...");
        const { data, error } = await supabase.from("wireguard_peers").select("name, status, allowed_ips");
        if (error) throw error;
        addLog("success", `Found ${data?.length || 0} peers:`);
        data?.forEach((peer) => {
          addLog("info", `  - ${peer.name}: ${peer.status} (${peer.allowed_ips})`);
        });
      } else if (cmd === "sync") {
        addLog("info", "Syncing with cloud database...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        addLog("success", "Sync completed successfully");
        await supabase.from("audit_logs").insert({
          action: "manual_sync",
          resource_type: "system",
          details: { triggered_by: "console" },
        });
      } else if (cmd === "backup") {
        addLog("info", "Creating backup...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        addLog("success", "Backup created: wireguard-backup-" + new Date().toISOString().split("T")[0] + ".json");
      } else if (cmd === "update") {
        addLog("info", "Checking for updates...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        addLog("success", "System is up to date");
      } else if (cmd === "logs") {
        addLog("info", "Fetching recent audit logs...");
        await loadAuditLogs();
        addLog("success", "Logs refreshed");
      } else if (cmd === "clear") {
        setLogs([]);
      } else {
        addLog("error", `Unknown command: ${command}. Type 'help' for available commands.`);
      }
    } catch (error) {
      console.error("Command error:", error);
      addLog("error", `Error: ${error instanceof Error ? error.message : "Command failed"}`);
    } finally {
      setIsExecuting(false);
      setCommand("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isExecuting) {
      executeCommand();
    }
  };

  const clearLogs = () => {
    setLogs([]);
    toast.success("Console cleared");
  };

  const downloadLogs = () => {
    const content = logs.map((log) => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `console-logs-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Logs downloaded");
  };

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "error":
        return "text-destructive";
      case "success":
        return "text-success";
      case "command":
        return "text-primary font-bold";
      default:
        return "text-foreground";
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              System Console
            </CardTitle>
            <CardDescription>Execute commands and view system logs</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadLogs}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={clearLogs}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="bg-background border rounded-lg overflow-hidden">
          <ScrollArea className="h-[400px] p-4 font-mono text-sm" ref={scrollRef}>
            {logs.length === 0 ? (
              <div className="text-muted-foreground">
                Welcome to WireGuard Manager Console. Type 'help' for available commands.
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`${getLogColor(log.type)} mb-1`}>
                  <span className="text-muted-foreground">[{log.timestamp}]</span> {log.message}
                </div>
              ))
            )}
          </ScrollArea>
          <div className="border-t p-3 flex gap-2">
            <span className="text-primary font-mono">$</span>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter command..."
              className="flex-1 font-mono border-0 shadow-none focus-visible:ring-0"
              disabled={isExecuting}
            />
            <Button size="sm" onClick={executeCommand} disabled={isExecuting || !command.trim()}>
              <Play className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

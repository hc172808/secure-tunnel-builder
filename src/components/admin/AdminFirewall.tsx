import { useState, useEffect } from "react";
import { Shield, Plus, Trash2, Edit2, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface FirewallRule {
  id: string;
  name: string;
  source_ip: string | null;
  destination_ip: string | null;
  protocol: string;
  port: string | null;
  action: string;
  priority: number;
  enabled: boolean;
  description: string | null;
  created_at: string;
}

export function AdminFirewall() {
  const { user } = useAuth();
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    source_ip: "",
    destination_ip: "",
    protocol: "any",
    port: "",
    action: "allow",
    priority: 100,
    description: "",
  });

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("firewall_rules" as any)
      .select("*")
      .order("priority", { ascending: true });

    if (error) {
      toast.error("Failed to fetch firewall rules");
      setRules([]);
    } else {
      setRules((data as unknown as FirewallRule[]) || []);
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!formData.name) {
      toast.error("Rule name is required");
      return;
    }

    const ruleData = {
      name: formData.name,
      source_ip: formData.source_ip || null,
      destination_ip: formData.destination_ip || null,
      protocol: formData.protocol,
      port: formData.port || null,
      action: formData.action,
      priority: formData.priority,
      description: formData.description || null,
      created_by: user?.id,
    };

    if (editingRule) {
      const { error } = await supabase
        .from("firewall_rules" as any)
        .update(ruleData as any)
        .eq("id", editingRule.id);

      if (error) {
        toast.error("Failed to update rule");
      } else {
        toast.success("Rule updated");
        await supabase.from("audit_logs").insert({
          user_id: user?.id,
          action: "UPDATE",
          resource_type: "firewall_rule",
          resource_id: editingRule.id,
          details: { name: formData.name },
        });
      }
    } else {
      const { error } = await supabase
        .from("firewall_rules" as any)
        .insert(ruleData as any);

      if (error) {
        toast.error("Failed to create rule");
      } else {
        toast.success("Rule created");
        await supabase.from("audit_logs").insert({
          user_id: user?.id,
          action: "CREATE",
          resource_type: "firewall_rule",
          details: { name: formData.name },
        });
      }
    }

    setDialogOpen(false);
    resetForm();
    fetchRules();
  };

  const handleDelete = async (rule: FirewallRule) => {
    const { error } = await supabase
      .from("firewall_rules" as any)
      .delete()
      .eq("id", rule.id);

    if (error) {
      toast.error("Failed to delete rule");
    } else {
      toast.success("Rule deleted");
      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "DELETE",
        resource_type: "firewall_rule",
        resource_id: rule.id,
        details: { name: rule.name },
      });
      fetchRules();
    }
  };

  const toggleRule = async (rule: FirewallRule) => {
    const { error } = await supabase
      .from("firewall_rules" as any)
      .update({ enabled: !rule.enabled } as any)
      .eq("id", rule.id);

    if (error) {
      toast.error("Failed to toggle rule");
    } else {
      toast.success(rule.enabled ? "Rule disabled" : "Rule enabled");
      fetchRules();
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      source_ip: "",
      destination_ip: "",
      protocol: "any",
      port: "",
      action: "allow",
      priority: 100,
      description: "",
    });
    setEditingRule(null);
  };

  const openEditDialog = (rule: FirewallRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      source_ip: rule.source_ip || "",
      destination_ip: rule.destination_ip || "",
      protocol: rule.protocol,
      port: rule.port || "",
      action: rule.action,
      priority: rule.priority,
      description: rule.description || "",
    });
    setDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Firewall Rules
          </h2>
          <p className="text-muted-foreground">
            Manage network firewall rules for the WireGuard server
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingRule ? "Edit Firewall Rule" : "Add Firewall Rule"}
              </DialogTitle>
              <DialogDescription>
                Configure firewall rules to control network traffic
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Rule Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Block SSH"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Input
                    id="priority"
                    type="number"
                    value={formData.priority}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priority: parseInt(e.target.value) || 100,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="source_ip">Source IP</Label>
                  <Input
                    id="source_ip"
                    value={formData.source_ip}
                    onChange={(e) =>
                      setFormData({ ...formData, source_ip: e.target.value })
                    }
                    placeholder="0.0.0.0/0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="destination_ip">Destination IP</Label>
                  <Input
                    id="destination_ip"
                    value={formData.destination_ip}
                    onChange={(e) =>
                      setFormData({ ...formData, destination_ip: e.target.value })
                    }
                    placeholder="10.0.0.0/24"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Protocol</Label>
                  <Select
                    value={formData.protocol}
                    onValueChange={(value) =>
                      setFormData({ ...formData, protocol: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                      <SelectItem value="icmp">ICMP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    value={formData.port}
                    onChange={(e) =>
                      setFormData({ ...formData, port: e.target.value })
                    }
                    placeholder="22, 80-443"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select
                    value={formData.action}
                    onValueChange={(value) =>
                      setFormData({ ...formData, action: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="deny">Deny</SelectItem>
                      <SelectItem value="drop">Drop</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Optional description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit}>
                {editingRule ? "Update" : "Create"} Rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Priority</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No firewall rules configured
                </TableCell>
              </TableRow>
            ) : (
              rules.map((rule) => (
                <TableRow key={rule.id} className={!rule.enabled ? "opacity-50" : ""}>
                  <TableCell className="font-mono">{rule.priority}</TableCell>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {rule.source_ip || "any"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {rule.destination_ip || "any"}
                  </TableCell>
                  <TableCell className="uppercase text-sm">{rule.protocol}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {rule.port || "any"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={rule.action === "allow" ? "default" : "destructive"}
                    >
                      {rule.action.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.enabled ? "outline" : "secondary"}>
                      {rule.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleRule(rule)}
                        title={rule.enabled ? "Disable" : "Enable"}
                      >
                        {rule.enabled ? (
                          <PowerOff className="h-4 w-4" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(rule)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(rule)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

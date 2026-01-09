import { useState, useEffect } from "react";
import { Tags, Plus, Pencil, Trash2, RefreshCw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface PeerGroup {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  peer_count?: number;
}

const PRESET_COLORS = [
  "#22c55e", // green
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export function AdminPeerGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PeerGroup | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    color: "#3b82f6",
    description: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      // Fetch groups
      const { data: groupsData, error: groupsError } = await supabase
        .from("peer_groups")
        .select("*")
        .order("name");

      if (groupsError) throw groupsError;

      // Fetch peer counts for each group
      const { data: peersData, error: peersError } = await supabase
        .from("wireguard_peers")
        .select("group_id");

      if (peersError) throw peersError;

      // Count peers per group
      const peerCounts: Record<string, number> = {};
      peersData?.forEach((peer) => {
        if (peer.group_id) {
          peerCounts[peer.group_id] = (peerCounts[peer.group_id] || 0) + 1;
        }
      });

      // Merge counts with groups
      const groupsWithCounts = groupsData?.map((group) => ({
        ...group,
        peer_count: peerCounts[group.id] || 0,
      }));

      setGroups(groupsWithCounts || []);
    } catch (error) {
      console.error("Error fetching groups:", error);
      toast.error("Failed to load peer groups");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (group?: PeerGroup) => {
    if (group) {
      setEditingGroup(group);
      setFormData({
        name: group.name,
        color: group.color,
        description: group.description || "",
      });
    } else {
      setEditingGroup(null);
      setFormData({
        name: "",
        color: "#3b82f6",
        description: "",
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Group name is required");
      return;
    }

    setSaving(true);
    try {
      if (editingGroup) {
        // Update existing group
        const { error } = await supabase
          .from("peer_groups")
          .update({
            name: formData.name,
            color: formData.color,
            description: formData.description || null,
          })
          .eq("id", editingGroup.id);

        if (error) throw error;

        await supabase.from("audit_logs").insert({
          user_id: user?.id,
          action: "UPDATE",
          resource_type: "peer_group",
          resource_id: editingGroup.id,
          details: { name: formData.name },
        });

        toast.success("Group updated successfully");
      } else {
        // Create new group
        const { error } = await supabase.from("peer_groups").insert({
          name: formData.name,
          color: formData.color,
          description: formData.description || null,
          created_by: user?.id,
        });

        if (error) throw error;

        await supabase.from("audit_logs").insert({
          user_id: user?.id,
          action: "CREATE",
          resource_type: "peer_group",
          details: { name: formData.name },
        });

        toast.success("Group created successfully");
      }

      setDialogOpen(false);
      fetchGroups();
    } catch (error) {
      console.error("Error saving group:", error);
      toast.error("Failed to save group");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: PeerGroup) => {
    if (group.peer_count && group.peer_count > 0) {
      toast.error(`Cannot delete group with ${group.peer_count} assigned peers`);
      return;
    }

    try {
      const { error } = await supabase
        .from("peer_groups")
        .delete()
        .eq("id", group.id);

      if (error) throw error;

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "DELETE",
        resource_type: "peer_group",
        resource_id: group.id,
        details: { name: group.name },
      });

      toast.success("Group deleted successfully");
      fetchGroups();
    } catch (error) {
      console.error("Error deleting group:", error);
      toast.error("Failed to delete group");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Tags className="h-6 w-6 text-primary" />
              <div>
                <CardTitle>Peer Groups</CardTitle>
                <CardDescription>
                  Organize peers into groups for easier management
                </CardDescription>
              </div>
            </div>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Group
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No peer groups created yet. Click "Add Group" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Peers</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: group.color }}
                        />
                        <span className="font-medium">{group.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {group.description || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{group.peer_count || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(group.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(group)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(group)}
                          disabled={group.peer_count && group.peer_count > 0}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingGroup ? "Edit Group" : "Add New Group"}
            </DialogTitle>
            <DialogDescription>
              {editingGroup
                ? "Update the group details below"
                : "Create a new peer group to organize your peers"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                placeholder="e.g., Mobile Devices"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`h-8 w-8 rounded-full transition-all ${
                      formData.color === color
                        ? "ring-2 ring-offset-2 ring-primary"
                        : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, color }))
                    }
                  />
                ))}
                <Input
                  type="color"
                  value={formData.color}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, color: e.target.value }))
                  }
                  className="h-8 w-8 p-0 border-0 cursor-pointer"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-description">Description (optional)</Label>
              <Input
                id="group-description"
                placeholder="e.g., All mobile devices like phones and tablets"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {editingGroup ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
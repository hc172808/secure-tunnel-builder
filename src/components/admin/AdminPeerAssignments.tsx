import { useState, useEffect } from "react";
import { Link, UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Assignment {
  id: string;
  peer_id: string;
  user_id: string;
  assigned_at: string;
  peer_name: string;
  user_display_name: string;
  username: string;
}

interface Peer {
  id: string;
  name: string;
}

interface User {
  user_id: string;
  display_name: string | null;
  username: string | null;
}

export function AdminPeerAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState("");
  const [selectedUser, setSelectedUser] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);

    // Fetch assignments
    const { data: assignmentsData } = await supabase
      .from("peer_assignments")
      .select("*")
      .order("assigned_at", { ascending: false });

    // Fetch peers
    const { data: peersData } = await supabase
      .from("wireguard_peers")
      .select("id, name");

    // Fetch users
    const { data: usersData } = await supabase
      .from("profiles")
      .select("user_id, display_name, username");

    if (assignmentsData && peersData && usersData) {
      const enrichedAssignments = assignmentsData.map((a) => {
        const peer = peersData.find((p) => p.id === a.peer_id);
        const user = usersData.find((u) => u.user_id === a.user_id);
        return {
          ...a,
          peer_name: peer?.name || "Unknown",
          user_display_name: user?.display_name || "Unknown",
          username: user?.username || "",
        };
      });
      setAssignments(enrichedAssignments);
    }

    setPeers(peersData || []);
    setUsers(usersData || []);
    setLoading(false);
  };

  const handleAssign = async () => {
    if (!selectedPeer || !selectedUser) {
      toast.error("Please select both a peer and a user");
      return;
    }

    const { error } = await supabase.from("peer_assignments").insert({
      peer_id: selectedPeer,
      user_id: selectedUser,
    });

    if (error) {
      if (error.message.includes("duplicate")) {
        toast.error("This peer is already assigned to this user");
      } else {
        toast.error("Failed to create assignment");
      }
      return;
    }

    // Log action
    await supabase.from("audit_logs").insert({
      action: "CREATE",
      resource_type: "peer_assignment",
      details: { peer_id: selectedPeer, user_id: selectedUser },
    });

    toast.success("Peer assigned successfully");
    setDialogOpen(false);
    setSelectedPeer("");
    setSelectedUser("");
    fetchData();
  };

  const handleRemove = async (assignmentId: string) => {
    const { error } = await supabase
      .from("peer_assignments")
      .delete()
      .eq("id", assignmentId);

    if (error) {
      toast.error("Failed to remove assignment");
      return;
    }

    // Log action
    await supabase.from("audit_logs").insert({
      action: "DELETE",
      resource_type: "peer_assignment",
      resource_id: assignmentId,
    });

    toast.success("Assignment removed");
    fetchData();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Peer Assignments</h2>
          <p className="text-sm text-muted-foreground">
            Assign VPN peers to specific users
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="glow">
              <UserPlus className="h-4 w-4 mr-2" />
              New Assignment
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>Assign Peer to User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Peer</Label>
                <Select value={selectedPeer} onValueChange={setSelectedPeer}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a peer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {peers.map((peer) => (
                      <SelectItem key={peer.id} value={peer.id}>
                        {peer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Select User</Label>
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.user_id} value={user.user_id}>
                        {user.display_name || user.username || "Unknown"}
                        {user.username && ` (@${user.username})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" variant="glow" onClick={handleAssign}>
                Assign Peer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="gradient-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Peer</TableHead>
              <TableHead className="text-muted-foreground">User</TableHead>
              <TableHead className="text-muted-foreground">Assigned</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((assignment) => (
              <TableRow key={assignment.id} className="border-border">
                <TableCell className="font-medium text-foreground">
                  <div className="flex items-center gap-2">
                    <Link className="h-4 w-4 text-primary" />
                    {assignment.peer_name}
                  </div>
                </TableCell>
                <TableCell className="text-foreground">
                  {assignment.user_display_name}
                  {assignment.username && (
                    <span className="text-muted-foreground text-sm ml-1">
                      (@{assignment.username})
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(assignment.assigned_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRemove(assignment.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {assignments.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Link className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No peer assignments yet</p>
          <p className="text-sm">Assign peers to users to give them VPN access</p>
        </div>
      )}
    </div>
  );
}

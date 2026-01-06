import { useState, useEffect } from "react";
import { Crown, Trash2, Shield, Power, PowerOff, UserPlus, Mail, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

interface UserWithRole {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  created_at: string;
  role: "admin" | "user";
  is_disabled: boolean;
}

export function AdminUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; userId: string | null; displayName: string }>({
    open: false,
    userId: null,
    displayName: "",
  });
  const [addUserDialog, setAddUserDialog] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", username: "", displayName: "" });
  const [addingUser, setAddingUser] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, user_id, username, display_name, created_at, is_disabled");

    if (profilesError) {
      toast.error("Failed to fetch users");
      setLoading(false);
      return;
    }

    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role");

    if (rolesError) {
      toast.error("Failed to fetch roles");
      setLoading(false);
      return;
    }

    const usersWithRoles = profiles.map((profile: any) => {
      const userRole = roles.find((r) => r.user_id === profile.user_id);
      return {
        ...profile,
        role: (userRole?.role || "user") as "admin" | "user",
        is_disabled: profile.is_disabled || false,
      };
    });

    setUsers(usersWithRoles);
    setLoading(false);
  };

  const toggleAdminRole = async (userId: string, currentRole: "admin" | "user") => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    
    if (currentRole === "admin") {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");

      if (error) {
        toast.error("Failed to update role");
        return;
      }
    } else {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });

      if (error) {
        toast.error("Failed to update role");
        return;
      }
    }

    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action: newRole === "admin" ? "GRANT_ADMIN" : "REVOKE_ADMIN",
      resource_type: "user_role",
      resource_id: userId,
      details: { new_role: newRole },
    });

    toast.success(`User role updated to ${newRole}`);
    fetchUsers();
  };

  const toggleUserStatus = async (targetUser: UserWithRole) => {
    const newStatus = !targetUser.is_disabled;
    
    const { error } = await supabase
      .from("profiles")
      .update({ is_disabled: newStatus } as any)
      .eq("user_id", targetUser.user_id);

    if (error) {
      toast.error("Failed to update user status");
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action: newStatus ? "DISABLE_USER" : "ENABLE_USER",
      resource_type: "user",
      resource_id: targetUser.user_id,
      details: { display_name: targetUser.display_name },
    });

    toast.success(newStatus ? "User disabled" : "User enabled");
    fetchUsers();
  };

  const handleDeleteUser = async () => {
    if (!deleteDialog.userId) return;

    // Note: Full user deletion requires admin API access
    // For now, we'll just disable the user
    const { error } = await supabase
      .from("profiles")
      .update({ is_disabled: true } as any)
      .eq("user_id", deleteDialog.userId);

    if (error) {
      toast.error("Failed to remove user");
    } else {
      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "DELETE_USER",
        resource_type: "user",
        resource_id: deleteDialog.userId,
        details: { display_name: deleteDialog.displayName },
      });
      toast.success("User has been disabled");
      fetchUsers();
    }

    setDeleteDialog({ open: false, userId: null, displayName: "" });
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.username || !newUser.displayName) {
      toast.error("All fields are required");
      return;
    }
    
    setAddingUser(true);
    
    // Create user via admin API - this creates the auth user
    const { data, error } = await supabase.auth.signUp({
      email: newUser.email,
      password: newUser.password,
      options: {
        data: {
          username: newUser.username,
          display_name: newUser.displayName,
        },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    if (error) {
      toast.error(error.message);
      setAddingUser(false);
      return;
    }

    if (data.user) {
      // Create profile
      await supabase.from("profiles").insert({
        user_id: data.user.id,
        username: newUser.username,
        display_name: newUser.displayName,
      });

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "CREATE_USER",
        resource_type: "user",
        resource_id: data.user.id,
        details: { email: newUser.email, username: newUser.username },
      });

      toast.success("User created successfully");
      fetchUsers();
    }

    setAddingUser(false);
    setAddUserDialog(false);
    setNewUser({ email: "", password: "", username: "", displayName: "" });
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
          <h2 className="text-lg font-semibold text-foreground">User Management</h2>
          <p className="text-sm text-muted-foreground">
            Manage user accounts, roles, and access
          </p>
        </div>
        <Dialog open={addUserDialog} onOpenChange={setAddUserDialog}>
          <DialogTrigger asChild>
            <Button variant="glow" size="sm">
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new-username">Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="new-username"
                      placeholder="johndoe"
                      className="pl-10"
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-displayname">Display Name</Label>
                  <Input
                    id="new-displayname"
                    placeholder="John Doe"
                    value={newUser.displayName}
                    onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-email"
                    type="email"
                    placeholder="user@example.com"
                    className="pl-10"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddUserDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddUser} disabled={addingUser}>
                {addingUser ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="gradient-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">User</TableHead>
              <TableHead className="text-muted-foreground">Username</TableHead>
              <TableHead className="text-muted-foreground">Role</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Joined</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className={`border-border ${u.is_disabled ? "opacity-50" : ""}`}>
                <TableCell className="font-medium text-foreground">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-primary text-sm font-bold">
                        {(u.display_name || u.username || "U").charAt(0).toUpperCase()}
                      </span>
                    </div>
                    {u.display_name || "Unknown"}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono">
                  @{u.username || "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.role === "admin" ? "default" : "secondary"}
                    className="flex items-center gap-1 w-fit"
                  >
                    {u.role === "admin" && <Crown className="h-3 w-3" />}
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={u.is_disabled ? "destructive" : "outline"}>
                    {u.is_disabled ? "Disabled" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleUserStatus(u)}
                      title={u.is_disabled ? "Enable User" : "Disable User"}
                    >
                      {u.is_disabled ? (
                        <Power className="h-4 w-4 text-success" />
                      ) : (
                        <PowerOff className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAdminRole(u.user_id, u.role)}
                    >
                      {u.role === "admin" ? (
                        <Shield className="h-4 w-4" />
                      ) : (
                        <Crown className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteDialog({ open: true, userId: u.user_id, displayName: u.display_name || "" })}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {users.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No users found
        </div>
      )}

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this user? They will be disabled and unable to access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

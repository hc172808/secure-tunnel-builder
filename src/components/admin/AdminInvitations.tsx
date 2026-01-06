import { useState, useEffect } from "react";
import { Mail, Send, Trash2, Copy, Clock, CheckCircle } from "lucide-react";
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

interface Invitation {
  id: string;
  email: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export function AdminInvitations() {
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendDialog, setSendDialog] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchInvitations();
  }, []);

  const fetchInvitations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invitations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch invitations");
    } else {
      setInvitations(data || []);
    }
    setLoading(false);
  };

  const handleSendInvitation = async () => {
    if (!newEmail) {
      toast.error("Email is required");
      return;
    }

    setSending(true);

    const { data, error } = await supabase
      .from("invitations")
      .insert({
        email: newEmail,
        invited_by: user?.id,
      })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create invitation");
    } else {
      const inviteLink = `${window.location.origin}/auth?invite=${data.token}`;
      
      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        action: "SEND_INVITATION",
        resource_type: "invitation",
        resource_id: data.id,
        details: { email: newEmail },
      });

      toast.success("Invitation created! Copy the link to send.");
      
      // Copy to clipboard
      navigator.clipboard.writeText(inviteLink);
      toast.info("Invite link copied to clipboard");
      
      fetchInvitations();
    }

    setSending(false);
    setSendDialog(false);
    setNewEmail("");
  };

  const handleCopyLink = (token: string) => {
    const inviteLink = `${window.location.origin}/auth?invite=${token}`;
    navigator.clipboard.writeText(inviteLink);
    toast.success("Invite link copied to clipboard");
  };

  const handleDeleteInvitation = async (id: string) => {
    const { error } = await supabase.from("invitations").delete().eq("id", id);

    if (error) {
      toast.error("Failed to delete invitation");
    } else {
      toast.success("Invitation deleted");
      fetchInvitations();
    }
  };

  const getStatus = (invitation: Invitation) => {
    if (invitation.used_at) return "used";
    if (new Date(invitation.expires_at) < new Date()) return "expired";
    return "pending";
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
          <h2 className="text-lg font-semibold text-foreground">User Invitations</h2>
          <p className="text-sm text-muted-foreground">
            Invite new users via email link
          </p>
        </div>
        <Dialog open={sendDialog} onOpenChange={setSendDialog}>
          <DialogTrigger asChild>
            <Button variant="glow" size="sm">
              <Send className="h-4 w-4 mr-2" />
              Send Invitation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send Invitation</DialogTitle>
              <DialogDescription>
                Create an invitation link for a new user
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="user@example.com"
                    className="pl-10"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSendInvitation} disabled={sending}>
                {sending ? "Creating..." : "Create Invite Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="gradient-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Email</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Expires</TableHead>
              <TableHead className="text-muted-foreground">Created</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => {
              const status = getStatus(invitation);
              return (
                <TableRow key={invitation.id} className="border-border">
                  <TableCell className="font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      {invitation.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        status === "used"
                          ? "default"
                          : status === "expired"
                          ? "destructive"
                          : "secondary"
                      }
                      className="flex items-center gap-1 w-fit"
                    >
                      {status === "used" && <CheckCircle className="h-3 w-3" />}
                      {status === "expired" && <Clock className="h-3 w-3" />}
                      {status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(invitation.expires_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(invitation.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {status === "pending" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopyLink(invitation.token)}
                          title="Copy Link"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteInvitation(invitation.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {invitations.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No invitations sent yet
        </div>
      )}
    </div>
  );
}

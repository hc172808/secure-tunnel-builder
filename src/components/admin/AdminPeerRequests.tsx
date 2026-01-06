import { useState, useEffect } from "react";
import { Check, X, Clock, User } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

interface PeerRequest {
  id: string;
  user_id: string;
  name: string;
  public_key: string | null;
  allowed_ips: string;
  status: string;
  created_at: string;
  username?: string;
  display_name?: string;
}

export function AdminPeerRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PeerRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    
    const { data: requestsData, error: requestsError } = await supabase
      .from("pending_peer_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (requestsError) {
      toast.error("Failed to fetch peer requests");
      setLoading(false);
      return;
    }

    // Get user profiles for display
    const userIds = [...new Set(requestsData?.map(r => r.user_id) || [])];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, username, display_name")
      .in("user_id", userIds);

    const requestsWithUsers = requestsData?.map(request => {
      const profile = profiles?.find(p => p.user_id === request.user_id);
      return {
        ...request,
        username: profile?.username,
        display_name: profile?.display_name,
      };
    }) || [];

    setRequests(requestsWithUsers);
    setLoading(false);
  };

  const handleApprove = async (request: PeerRequest) => {
    // Create the actual peer
    const { data: newPeer, error: peerError } = await supabase
      .from("wireguard_peers")
      .insert({
        name: request.name,
        public_key: request.public_key || btoa(Math.random().toString()).slice(0, 44) + "=",
        allowed_ips: request.allowed_ips,
        created_by: request.user_id,
        status: "pending",
      })
      .select()
      .single();

    if (peerError) {
      toast.error("Failed to create peer");
      return;
    }

    // Create peer assignment
    await supabase.from("peer_assignments").insert({
      peer_id: newPeer.id,
      user_id: request.user_id,
      assigned_by: user?.id,
    });

    // Update request status
    await supabase
      .from("pending_peer_requests")
      .update({ status: "approved", approved_by: user?.id })
      .eq("id", request.id);

    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action: "APPROVE_PEER_REQUEST",
      resource_type: "peer_request",
      resource_id: request.id,
      details: { peer_name: request.name, requesting_user: request.user_id },
    });

    toast.success("Peer request approved and peer created");
    fetchRequests();
  };

  const handleReject = async (request: PeerRequest) => {
    await supabase
      .from("pending_peer_requests")
      .update({ status: "rejected" })
      .eq("id", request.id);

    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action: "REJECT_PEER_REQUEST",
      resource_type: "peer_request",
      resource_id: request.id,
      details: { peer_name: request.name, requesting_user: request.user_id },
    });

    toast.success("Peer request rejected");
    fetchRequests();
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

  const pendingRequests = requests.filter(r => r.status === "pending");
  const processedRequests = requests.filter(r => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Pending Peer Requests</h2>
        <p className="text-sm text-muted-foreground">
          Approve or reject peer creation requests from API/scripts
        </p>
      </div>

      {pendingRequests.length > 0 ? (
        <div className="gradient-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Peer Name</TableHead>
                <TableHead className="text-muted-foreground">Requested By</TableHead>
                <TableHead className="text-muted-foreground">Allowed IPs</TableHead>
                <TableHead className="text-muted-foreground">Requested</TableHead>
                <TableHead className="text-muted-foreground text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingRequests.map((request) => (
                <TableRow key={request.id} className="border-border">
                  <TableCell className="font-medium text-foreground">
                    {request.name}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">
                        {request.display_name || request.username || "Unknown"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {request.allowed_ips}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(request.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApprove(request)}
                        className="text-success hover:text-success"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReject(request)}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground border border-border rounded-xl">
          <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No pending requests
        </div>
      )}

      {processedRequests.length > 0 && (
        <>
          <h3 className="text-md font-semibold text-foreground mt-8">Request History</h3>
          <div className="gradient-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Peer Name</TableHead>
                  <TableHead className="text-muted-foreground">Requested By</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedRequests.map((request) => (
                  <TableRow key={request.id} className="border-border">
                    <TableCell className="font-medium text-foreground">
                      {request.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {request.display_name || request.username || "Unknown"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={request.status === "approved" ? "default" : "destructive"}
                      >
                        {request.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(request.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

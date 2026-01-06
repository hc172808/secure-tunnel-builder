import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Users, Settings, History, ChevronLeft, Crown, Link, Flame, Database, Terminal, Mail, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";
import { AdminServerSettings } from "@/components/admin/AdminServerSettings";
import { AdminPeerAssignments } from "@/components/admin/AdminPeerAssignments";
import { AdminFirewall } from "@/components/admin/AdminFirewall";
import { AdminDatabaseControls } from "@/components/admin/AdminDatabaseControls";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { AdminInvitations } from "@/components/admin/AdminInvitations";
import { AdminPeerRequests } from "@/components/admin/AdminPeerRequests";
import { PeerNotifications } from "@/components/admin/PeerNotifications";

export default function Admin() {
  const navigate = useNavigate();
  const { user, loading, isAdmin } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate("/auth");
      } else if (!isAdmin) {
        toast.error("Access denied. Admin privileges required.");
        navigate("/");
      }
    }
  }, [user, loading, isAdmin, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-primary">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Shield className="h-8 w-8 text-primary" />
                  <Crown className="absolute -top-1 -right-1 h-4 w-4 text-warning" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground">Admin Panel</h1>
                  <p className="text-xs text-muted-foreground">Manage users, peers, and settings</p>
                </div>
              </div>
            </div>
            <PeerNotifications />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="users" className="w-full">
          <TabsList className="flex flex-wrap w-full gap-1 mb-8">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Users</span>
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span className="hidden sm:inline">Invites</span>
            </TabsTrigger>
            <TabsTrigger value="peer-requests" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Requests</span>
            </TabsTrigger>
            <TabsTrigger value="assignments" className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              <span className="hidden sm:inline">Assignments</span>
            </TabsTrigger>
            <TabsTrigger value="firewall" className="flex items-center gap-2">
              <Flame className="h-4 w-4" />
              <span className="hidden sm:inline">Firewall</span>
            </TabsTrigger>
            <TabsTrigger value="database" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">Database</span>
            </TabsTrigger>
            <TabsTrigger value="console" className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              <span className="hidden sm:inline">Console</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Logs</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <AdminUsers />
          </TabsContent>

          <TabsContent value="invitations">
            <AdminInvitations />
          </TabsContent>

          <TabsContent value="peer-requests">
            <AdminPeerRequests />
          </TabsContent>

          <TabsContent value="assignments">
            <AdminPeerAssignments />
          </TabsContent>

          <TabsContent value="firewall">
            <AdminFirewall />
          </TabsContent>

          <TabsContent value="database">
            <AdminDatabaseControls />
          </TabsContent>

          <TabsContent value="console">
            <AdminConsole />
          </TabsContent>

          <TabsContent value="settings">
            <AdminServerSettings />
          </TabsContent>

          <TabsContent value="logs">
            <AdminAuditLogs />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Users, Settings, History, ChevronLeft, UserPlus, Trash2, Crown, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";
import { AdminServerSettings } from "@/components/admin/AdminServerSettings";
import { AdminPeerAssignments } from "@/components/admin/AdminPeerAssignments";

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
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="users" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="assignments" className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              Assignments
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Audit Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <AdminUsers />
          </TabsContent>

          <TabsContent value="assignments">
            <AdminPeerAssignments />
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

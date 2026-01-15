import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Wifi, WifiOff, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface PeerEvent {
  id: string;
  peer_id: string | null;
  peer_name: string;
  event_type: string;
  created_at: string;
  read: boolean;
}

export function PeerConnectionNotifications() {
  const { user, isAdmin } = useAuth();
  const previousPeersRef = useRef<Map<string, string>>(new Map());
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (!user) return;

    // Subscribe to real-time peer status changes
    const peerChannel = supabase
      .channel("peer-status-notifications")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wireguard_peers",
        },
        (payload) => {
          const newPeer = payload.new as { id: string; name: string; status: string };
          const oldPeer = payload.old as { id: string; name: string; status: string };
          
          // Skip first load notifications
          if (isFirstLoadRef.current) return;
          
          // Check if status changed
          if (oldPeer.status !== newPeer.status) {
            if (newPeer.status === "connected") {
              toast.success(`${newPeer.name} connected`, {
                icon: <Wifi className="h-4 w-4 text-success" />,
                description: "Peer is now online",
              });
            } else if (newPeer.status === "disconnected" && oldPeer.status === "connected") {
              toast.info(`${newPeer.name} disconnected`, {
                icon: <WifiOff className="h-4 w-4 text-muted-foreground" />,
                description: "Peer went offline",
              });
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wireguard_peers",
        },
        (payload) => {
          if (isFirstLoadRef.current) return;
          const newPeer = payload.new as { name: string };
          toast.success(`New peer added: ${newPeer.name}`, {
            icon: <Plus className="h-4 w-4" />,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "wireguard_peers",
        },
        (payload) => {
          if (isFirstLoadRef.current) return;
          const oldPeer = payload.old as { name: string };
          if (oldPeer.name) {
            toast.info(`Peer removed: ${oldPeer.name}`, {
              icon: <Trash2 className="h-4 w-4" />,
            });
          }
        }
      )
      .subscribe();

    // Subscribe to peer notifications table for admin
    let notificationChannel: ReturnType<typeof supabase.channel> | null = null;
    
    if (isAdmin) {
      notificationChannel = supabase
        .channel("peer-notifications-realtime")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "peer_notifications",
          },
          async (payload) => {
            const notification = payload.new as PeerEvent;
            
            // Show toast for new notifications
            switch (notification.event_type) {
              case "peer_connected":
                toast.success(`${notification.peer_name} connected`, {
                  icon: <Wifi className="h-4 w-4 text-success" />,
                });
                break;
              case "peer_disconnected":
                toast.info(`${notification.peer_name} disconnected`, {
                  icon: <WifiOff className="h-4 w-4" />,
                });
                break;
              case "peer_created":
                toast.success(`New peer: ${notification.peer_name}`, {
                  icon: <Plus className="h-4 w-4" />,
                });
                break;
            }
            
            // Mark as read
            await supabase
              .from("peer_notifications")
              .update({ read: true })
              .eq("id", notification.id);
          }
        )
        .subscribe();
    }

    // Mark first load complete after a short delay
    const timer = setTimeout(() => {
      isFirstLoadRef.current = false;
    }, 2000);

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(peerChannel);
      if (notificationChannel) {
        supabase.removeChannel(notificationChannel);
      }
    };
  }, [user, isAdmin]);

  // This component doesn't render anything visible
  return null;
}

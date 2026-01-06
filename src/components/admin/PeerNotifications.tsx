import { useState, useEffect } from "react";
import { Bell, Wifi, WifiOff, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PeerNotification {
  id: string;
  peer_id: string | null;
  peer_name: string;
  event_type: string;
  read: boolean;
  created_at: string;
}

export function PeerNotifications() {
  const [notifications, setNotifications] = useState<PeerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();

    // Subscribe to new notifications
    const channel = supabase
      .channel("peer-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "peer_notifications",
        },
        (payload) => {
          const newNotification = payload.new as PeerNotification;
          setNotifications((prev) => [newNotification, ...prev]);
          setUnreadCount((prev) => prev + 1);
          
          // Show toast for new notification
          if (newNotification.event_type === "connected") {
            toast.success(`${newNotification.peer_name} connected`, {
              icon: <Wifi className="h-4 w-4 text-success" />,
            });
          } else {
            toast.warning(`${newNotification.peer_name} disconnected`, {
              icon: <WifiOff className="h-4 w-4 text-destructive" />,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from("peer_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read).length);
    }
  };

  const markAsRead = async (id: string) => {
    await supabase
      .from("peer_notifications")
      .update({ read: true })
      .eq("id", id);

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    
    await supabase
      .from("peer_notifications")
      .update({ read: true })
      .in("id", unreadIds);

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const clearAll = async () => {
    await supabase
      .from("peer_notifications")
      .delete()
      .neq("id", "placeholder");

    setNotifications([]);
    setUnreadCount(0);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Notifications</h3>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllAsRead}>
                <Check className="h-4 w-4 mr-1" />
                Read all
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                    !notification.read ? "bg-primary/5" : ""
                  }`}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-full ${
                        notification.event_type === "connected"
                          ? "bg-success/20"
                          : "bg-destructive/20"
                      }`}
                    >
                      {notification.event_type === "connected" ? (
                        <Wifi className="h-4 w-4 text-success" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {notification.peer_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {notification.event_type === "connected"
                          ? "Connected to VPN"
                          : "Disconnected from VPN"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatTime(notification.created_at)}
                      </p>
                    </div>
                    {!notification.read && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

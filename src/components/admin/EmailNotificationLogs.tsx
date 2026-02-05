 import { useState, useEffect } from "react";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Badge } from "@/components/ui/badge";
 import { ScrollArea } from "@/components/ui/scroll-area";
 import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
 import { 
 RefreshCw, 
 Mail, 
 CheckCircle, 
 XCircle, 
 Clock, 
 Trash2,
 Wifi,
 WifiOff,
 Plus,
UserMinus,
ChevronLeft,
ChevronRight,
ChevronsLeft,
ChevronsRight
 } from "lucide-react";
 import { supabase } from "@/integrations/supabase/client";
 import { toast } from "sonner";
 import { format, formatDistanceToNow } from "date-fns";
 import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
   AlertDialogTrigger,
 } from "@/components/ui/alert-dialog";
 
 interface EmailLog {
   id: string;
   peer_id: string | null;
   peer_name: string;
   event_type: string;
   recipient_email: string;
   subject: string;
   status: string;
   error_message: string | null;
   created_at: string;
   sent_at: string | null;
 }
 
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

 export function EmailNotificationLogs() {
   const [logs, setLogs] = useState<EmailLog[]>([]);
   const [loading, setLoading] = useState(true);
   const [refreshing, setRefreshing] = useState(false);
   const [currentPage, setCurrentPage] = useState(1);
   const [pageSize, setPageSize] = useState(25);
   const [totalCount, setTotalCount] = useState(0);
   const [stats, setStats] = useState({ total: 0, sent: 0, failed: 0, pending: 0 });
 
   const fetchLogs = async (page = currentPage, size = pageSize) => {
     try {
       // Fetch total count and stats
       const { count, error: countError } = await supabase
         .from("email_notification_logs")
         .select("*", { count: "exact", head: true });
 
       if (countError) throw countError;
       setTotalCount(count || 0);
 
       // Fetch stats
       const { data: allLogs } = await supabase
         .from("email_notification_logs")
         .select("status");
       
       if (allLogs) {
         setStats({
           total: allLogs.length,
           sent: allLogs.filter(l => l.status === "sent").length,
           failed: allLogs.filter(l => l.status === "failed").length,
           pending: allLogs.filter(l => l.status === "pending").length,
         });
       }
 
       // Fetch paginated logs
       const from = (page - 1) * size;
       const to = from + size - 1;
 
       const { data, error } = await supabase
         .from("email_notification_logs")
         .select("*")
         .order("created_at", { ascending: false })
         .range(from, to);
 
       if (error) throw error;
       setLogs((data as EmailLog[]) || []);
     } catch (error) {
       console.error("Error fetching email logs:", error);
       toast.error("Failed to load email logs");
     } finally {
       setLoading(false);
       setRefreshing(false);
     }
   };
 
   useEffect(() => {
     fetchLogs();
   }, [currentPage, pageSize]);
 
   const handleRefresh = () => {
     setRefreshing(true);
     fetchLogs(currentPage, pageSize);
   };
 
   const clearAllLogs = async () => {
     try {
       const { error } = await supabase
         .from("email_notification_logs")
         .delete()
         .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all
 
       if (error) throw error;
       setLogs([]);
       setTotalCount(0);
       setStats({ total: 0, sent: 0, failed: 0, pending: 0 });
       setCurrentPage(1);
       toast.success("All logs cleared");
     } catch (error) {
       console.error("Error clearing logs:", error);
       toast.error("Failed to clear logs");
     }
   };
 
   const getStatusBadge = (status: string) => {
     switch (status) {
       case "sent":
         return (
           <Badge variant="default" className="bg-success text-success-foreground">
             <CheckCircle className="h-3 w-3 mr-1" />
             Sent
           </Badge>
         );
       case "failed":
         return (
           <Badge variant="destructive">
             <XCircle className="h-3 w-3 mr-1" />
             Failed
           </Badge>
         );
       case "pending":
         return (
           <Badge variant="secondary">
             <Clock className="h-3 w-3 mr-1" />
             Pending
           </Badge>
         );
       default:
         return <Badge variant="outline">{status}</Badge>;
     }
   };
 
   const getEventIcon = (eventType: string) => {
     switch (eventType) {
       case "peer_connected":
         return <Wifi className="h-4 w-4 text-success" />;
       case "peer_disconnected":
         return <WifiOff className="h-4 w-4 text-muted-foreground" />;
       case "peer_created":
         return <Plus className="h-4 w-4 text-primary" />;
       case "peer_deleted":
         return <UserMinus className="h-4 w-4 text-destructive" />;
       default:
         return <Mail className="h-4 w-4" />;
     }
   };
 
   const getEventLabel = (eventType: string) => {
     switch (eventType) {
       case "peer_connected":
         return "Connected";
       case "peer_disconnected":
         return "Disconnected";
       case "peer_created":
         return "Created";
       case "peer_deleted":
         return "Deleted";
       default:
         return eventType;
     }
   };
 
   const totalPages = Math.ceil(totalCount / pageSize);
 
   const goToPage = (page: number) => {
     if (page >= 1 && page <= totalPages) {
       setCurrentPage(page);
     }
   };
 
   const handlePageSizeChange = (value: string) => {
     const newSize = parseInt(value);
     setPageSize(newSize);
     setCurrentPage(1);
   };
 
   if (loading) {
     return (
       <Card>
         <CardHeader>
           <CardTitle className="flex items-center gap-2">
             <Mail className="h-5 w-5" />
             Email Notification History
           </CardTitle>
         </CardHeader>
         <CardContent className="space-y-4">
           {[1, 2, 3].map((i) => (
             <div key={i} className="flex items-center gap-4">
               <Skeleton className="h-10 w-10 rounded-full" />
               <div className="flex-1 space-y-2">
                 <Skeleton className="h-4 w-1/3" />
                 <Skeleton className="h-3 w-1/2" />
               </div>
             </div>
           ))}
         </CardContent>
       </Card>
     );
   }
 
   return (
     <Card>
       <CardHeader>
         <div className="flex items-center justify-between">
           <div>
             <CardTitle className="flex items-center gap-2">
               <Mail className="h-5 w-5" />
               Email Notification History
             </CardTitle>
             <CardDescription>
               Recent email notifications sent for peer events
             </CardDescription>
           </div>
           <div className="flex items-center gap-2">
             <Button
               variant="outline"
               size="sm"
               onClick={handleRefresh}
               disabled={refreshing}
             >
               <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
               Refresh
             </Button>
             {logs.length > 0 && (
               <AlertDialog>
                 <AlertDialogTrigger asChild>
                   <Button variant="destructive" size="sm">
                     <Trash2 className="h-4 w-4 mr-2" />
                     Clear All
                   </Button>
                 </AlertDialogTrigger>
                 <AlertDialogContent>
                   <AlertDialogHeader>
                     <AlertDialogTitle>Clear all email logs?</AlertDialogTitle>
                     <AlertDialogDescription>
                       This will permanently delete all {logs.length} email notification logs.
                       This action cannot be undone.
                     </AlertDialogDescription>
                   </AlertDialogHeader>
                   <AlertDialogFooter>
                     <AlertDialogCancel>Cancel</AlertDialogCancel>
                     <AlertDialogAction onClick={clearAllLogs}>
                       Clear All
                     </AlertDialogAction>
                   </AlertDialogFooter>
                 </AlertDialogContent>
               </AlertDialog>
             )}
           </div>
         </div>
       </CardHeader>
       <CardContent>
         {/* Stats */}
         <div className="grid grid-cols-4 gap-4 mb-6">
           <div className="text-center p-3 bg-muted rounded-lg">
             <div className="text-2xl font-bold">{stats.total}</div>
             <div className="text-xs text-muted-foreground">Total</div>
           </div>
           <div className="text-center p-3 bg-success/10 rounded-lg">
             <div className="text-2xl font-bold text-success">{stats.sent}</div>
             <div className="text-xs text-muted-foreground">Sent</div>
           </div>
           <div className="text-center p-3 bg-destructive/10 rounded-lg">
             <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
             <div className="text-xs text-muted-foreground">Failed</div>
           </div>
           <div className="text-center p-3 bg-warning/10 rounded-lg">
             <div className="text-2xl font-bold text-warning">{stats.pending}</div>
             <div className="text-xs text-muted-foreground">Pending</div>
           </div>
         </div>
 
         {logs.length === 0 ? (
           <div className="text-center py-12 text-muted-foreground">
             <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
             <p>No email notifications sent yet</p>
             <p className="text-sm mt-1">
               Configure email settings and enable notifications to start logging
             </p>
           </div>
         ) : (
             <>
             <ScrollArea className="h-[350px]">
             <div className="space-y-3">
               {logs.map((log) => (
                 <div
                   key={log.id}
                   className="flex items-start gap-4 p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                 >
                   <div className="flex-shrink-0 mt-1">
                     {getEventIcon(log.event_type)}
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 mb-1">
                       <span className="font-medium truncate">{log.peer_name}</span>
                       <Badge variant="outline" className="text-xs">
                         {getEventLabel(log.event_type)}
                       </Badge>
                       {getStatusBadge(log.status)}
                     </div>
                     <div className="text-sm text-muted-foreground truncate">
                       To: {log.recipient_email}
                     </div>
                     <div className="text-sm text-muted-foreground truncate">
                       Subject: {log.subject}
                     </div>
                     {log.error_message && (
                       <div className="text-sm text-destructive mt-1">
                         Error: {log.error_message}
                       </div>
                     )}
                   </div>
                   <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                     <div title={format(new Date(log.created_at), "PPpp")}>
                       {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                     </div>
                     {log.sent_at && (
                       <div className="text-success">
                         Sent: {format(new Date(log.sent_at), "HH:mm:ss")}
                       </div>
                     )}
                   </div>
                 </div>
               ))}
             </div>
           </ScrollArea>
             
             {/* Pagination Controls */}
             <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
               <div className="flex items-center gap-2 text-sm text-muted-foreground">
                 <span>Rows per page:</span>
                 <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                   <SelectTrigger className="w-[70px] h-8">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     {PAGE_SIZE_OPTIONS.map((size) => (
                       <SelectItem key={size} value={size.toString()}>
                         {size}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
               </div>
 
               <div className="flex items-center gap-1 text-sm text-muted-foreground">
                 <span>
                   Page {currentPage} of {totalPages || 1}
                 </span>
                 <span className="mx-2">•</span>
                 <span>
                   {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
                 </span>
               </div>
 
               <div className="flex items-center gap-1">
                 <Button
                   variant="outline"
                   size="icon"
                   className="h-8 w-8"
                   onClick={() => goToPage(1)}
                   disabled={currentPage === 1}
                 >
                   <ChevronsLeft className="h-4 w-4" />
                 </Button>
                 <Button
                   variant="outline"
                   size="icon"
                   className="h-8 w-8"
                   onClick={() => goToPage(currentPage - 1)}
                   disabled={currentPage === 1}
                 >
                   <ChevronLeft className="h-4 w-4" />
                 </Button>
                 <Button
                   variant="outline"
                   size="icon"
                   className="h-8 w-8"
                   onClick={() => goToPage(currentPage + 1)}
                   disabled={currentPage >= totalPages}
                 >
                   <ChevronRight className="h-4 w-4" />
                 </Button>
                 <Button
                   variant="outline"
                   size="icon"
                   className="h-8 w-8"
                   onClick={() => goToPage(totalPages)}
                   disabled={currentPage >= totalPages}
                 >
                   <ChevronsRight className="h-4 w-4" />
                 </Button>
               </div>
             </div>
             </>
         )}
       </CardContent>
     </Card>
   );
 }
import { useState, useEffect, useCallback, useRef } from "react";
import { Globe, RefreshCw, Eye, EyeOff, Save, ExternalLink, CheckCircle, AlertCircle, Clock, Play, Pause, Info } from "lucide-react";
import { DDNSUpdateHistory } from "./DDNSUpdateHistory";
import { DDNSMultiHostname } from "./DDNSMultiHostname";
import { DDNSHealthMonitor } from "./DDNSHealthMonitor";
import { DDNSCronSchedule } from "./DDNSCronSchedule";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Label } from "@/components/ui/label";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
 import { Switch } from "@/components/ui/switch";
 import { Badge } from "@/components/ui/badge";
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
 import { Alert, AlertDescription } from "@/components/ui/alert";
 import { supabase } from "@/integrations/supabase/client";
 import { toast } from "sonner";
 import { useAuth } from "@/hooks/useAuth";
 
 // DDNS Provider definitions
 interface DDNSProvider {
   id: string;
   name: string;
   website: string;
   domains: string[];
   hostnamePattern: RegExp;
   hostnameExample: string;
   supportsToken: boolean;
   requiresUsername: boolean;
   requiresPassword: boolean;
   updateUrl: string;
   instructions: string[];
 }
 
 const DDNS_PROVIDERS: DDNSProvider[] = [
   {
     id: "noip",
     name: "No-IP",
     website: "https://www.noip.com",
     domains: ["ddns.net", "hopto.org", "zapto.org", "sytes.net", "ddns.me", "ddns.info"],
     hostnamePattern: /^[\w-]+\.(ddns\.net|hopto\.org|zapto\.org|sytes\.net|ddns\.me|ddns\.info)$/i,
     hostnameExample: "yourname.ddns.net",
     supportsToken: false,
     requiresUsername: true,
     requiresPassword: true,
     updateUrl: "https://dynupdate.no-ip.com/nic/update",
     instructions: [
       "Create a free account at noip.com",
       "Create a hostname (e.g., yourname.ddns.net)",
       "Enter your No-IP email and password above",
       "Free hostnames require confirmation every 30 days",
     ],
   },
   {
     id: "duckdns",
     name: "DuckDNS",
     website: "https://www.duckdns.org",
     domains: ["duckdns.org"],
     hostnamePattern: /^[\w-]+\.duckdns\.org$/i,
     hostnameExample: "yourname.duckdns.org",
     supportsToken: true,
     requiresUsername: false,
     requiresPassword: false,
     updateUrl: "https://www.duckdns.org/update",
     instructions: [
       "Sign in at duckdns.org using your social account",
       "Create a subdomain (e.g., yourname.duckdns.org)",
       "Copy your token from the DuckDNS dashboard",
       "Enter your subdomain and token above",
       "DuckDNS is completely free with no renewal required",
     ],
   },
   {
     id: "dynu",
     name: "Dynu",
     website: "https://www.dynu.com",
     domains: ["dynu.net", "dynu.com", "freeddns.org", "ddnsfree.com", "mywire.org", "webredirect.org"],
     hostnamePattern: /^[\w-]+\.(dynu\.net|dynu\.com|freeddns\.org|ddnsfree\.com|mywire\.org|webredirect\.org)$/i,
     hostnameExample: "yourname.dynu.net",
     supportsToken: false,
     requiresUsername: true,
     requiresPassword: true,
     updateUrl: "https://api.dynu.com/nic/update",
     instructions: [
       "Create a free account at dynu.com",
       "Add a DDNS hostname from the control panel",
       "Enter your Dynu username and password",
       "Free accounts never expire",
     ],
   },
   {
     id: "freedns",
     name: "FreeDNS (afraid.org)",
     website: "https://freedns.afraid.org",
     domains: ["afraid.org", "mooo.com", "chickenkiller.com", "strangled.net", "crabdance.com"],
     hostnamePattern: /^[\w-]+\.(afraid\.org|mooo\.com|chickenkiller\.com|strangled\.net|crabdance\.com|[\w-]+\.\w+)$/i,
     hostnameExample: "yourname.mooo.com",
     supportsToken: true,
     requiresUsername: false,
     requiresPassword: false,
     updateUrl: "https://freedns.afraid.org/dynamic/update.php",
     instructions: [
       "Create a free account at freedns.afraid.org",
       "Add a subdomain from available shared domains",
       "Get your update token from the Dynamic DNS page",
       "Thousands of free domain options available",
     ],
   },
   {
     id: "cloudflare",
     name: "Cloudflare",
     website: "https://www.cloudflare.com",
     domains: [],
     hostnamePattern: /^[\w.-]+\.[\w.-]+$/i,
     hostnameExample: "subdomain.yourdomain.com",
     supportsToken: true,
     requiresUsername: false,
     requiresPassword: false,
     updateUrl: "https://api.cloudflare.com/client/v4/zones",
     instructions: [
       "Add your domain to Cloudflare (free plan works)",
       "Create an API token with DNS edit permissions",
       "Enter your full hostname and Zone ID",
       "Works with any domain you own",
     ],
   },
   {
     id: "custom",
     name: "Custom Provider",
     website: "",
     domains: [],
     hostnamePattern: /^[\w.-]+$/i,
     hostnameExample: "any.hostname.format",
     supportsToken: true,
     requiresUsername: true,
     requiresPassword: true,
     updateUrl: "",
     instructions: [
       "Enter your custom DDNS update URL",
       "The URL should support DynDNS2 protocol",
       "Variables: {hostname}, {ip}, {username}, {password}, {token}",
     ],
   },
 ];
 
 interface DDNSSettings {
   enabled: boolean;
   provider: string;
   username: string;
   password: string;
   token: string;
   hostname: string;
   zoneId: string;
   customUrl: string;
   lastUpdate: string | null;
   lastIP: string | null;
   updateInterval: number;
   autoUpdateEnabled: boolean;
   nextUpdate: string | null;
 }
 
 export function AdminDynamicDNS() {
   const { user } = useAuth();
   const [settings, setSettings] = useState<DDNSSettings>({
     enabled: false,
     provider: "noip",
     username: "",
     password: "",
     token: "",
     hostname: "",
     zoneId: "",
     customUrl: "",
     lastUpdate: null,
     lastIP: null,
     updateInterval: 30,
     autoUpdateEnabled: false,
     nextUpdate: null,
   });
   const [showPassword, setShowPassword] = useState(false);
   const [showToken, setShowToken] = useState(false);
   const [loading, setLoading] = useState(true);
   const [saving, setSaving] = useState(false);
   const [updating, setUpdating] = useState(false);
   const [currentIP, setCurrentIP] = useState<string | null>(null);
   const [hostnameError, setHostnameError] = useState<string | null>(null);
   const [timeUntilUpdate, setTimeUntilUpdate] = useState<string>("");
   const updateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
   const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
 
   const currentProvider = DDNS_PROVIDERS.find(p => p.id === settings.provider) || DDNS_PROVIDERS[0];
 
   const validateHostname = useCallback((hostname: string, providerId: string) => {
     if (!hostname) {
       setHostnameError(null);
       return true;
     }
     
     const provider = DDNS_PROVIDERS.find(p => p.id === providerId);
     if (!provider) return true;
     
     if (providerId === "custom" || providerId === "cloudflare") {
       // More lenient validation for custom/cloudflare
       if (!/^[\w.-]+$/.test(hostname)) {
         setHostnameError("Invalid characters in hostname");
         return false;
       }
       setHostnameError(null);
       return true;
     }
     
     if (!provider.hostnamePattern.test(hostname)) {
       const validDomains = provider.domains.join(", ");
       setHostnameError(`Invalid format. Must be like ${provider.hostnameExample}. Valid domains: ${validDomains}`);
       return false;
     }
     
     setHostnameError(null);
     return true;
   }, []);
 
   const fetchCurrentIP = async () => {
     try {
       const response = await fetch("https://api.ipify.org?format=json");
       const data = await response.json();
       setCurrentIP(data.ip);
       return data.ip;
     } catch (error) {
       console.error("Error fetching current IP:", error);
       return null;
     }
   };
 
   const saveSetting = useCallback(async (key: string, value: string) => {
     const { data: existing } = await supabase
       .from("server_settings")
       .select("id")
       .eq("setting_key", key)
       .maybeSingle();
 
     if (existing) {
       await supabase
         .from("server_settings")
         .update({ setting_value: value, updated_by: user?.id })
         .eq("setting_key", key);
     } else {
       await supabase.from("server_settings").insert({
         setting_key: key,
         setting_value: value,
         description: `DDNS ${key.replace("ddns_", "").replace("noip_", "")} setting`,
         updated_by: user?.id,
       });
     }
   }, [user?.id]);
 
   const performIPUpdate = useCallback(async () => {
     try {
       const { data: sessionData } = await supabase.auth.getSession();
       const accessToken = sessionData.session?.access_token;
       
       const response = await fetch(
         `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ddns-update/update`,
         {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'Authorization': `Bearer ${accessToken}`,
           },
           body: JSON.stringify({ provider: settings.provider }),
         }
       );
       
       const result = await response.json();
       
       if (!response.ok || !result.success) {
         throw new Error(result.message || result.error || 'Failed to update DDNS');
       }
       
       const newIP = result.ip || "Unknown";
       
       setSettings((prev) => ({
         ...prev,
         lastUpdate: new Date().toISOString(),
         lastIP: newIP,
       }));
       
       return newIP;
     } catch (error) {
       // Fallback to legacy No-IP endpoint for backwards compatibility
       if (settings.provider === "noip") {
         const { data: sessionData } = await supabase.auth.getSession();
         const accessToken = sessionData.session?.access_token;
         
         const response = await fetch(
           `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/noip-update/update`,
           {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${accessToken}`,
             },
             body: JSON.stringify({}),
           }
         );
         
         const result = await response.json();
         
         if (!response.ok || !result.success) {
           throw new Error(result.message || result.error || 'Failed to update DDNS');
         }
         
         const newIP = result.ip || "Unknown";
         
         setSettings((prev) => ({
           ...prev,
           lastUpdate: new Date().toISOString(),
           lastIP: newIP,
         }));
         
         return newIP;
       }
       throw error;
     }
   }, [settings.provider]);
 
   const startAutoUpdateTimer = useCallback((intervalMinutes: number) => {
     if (updateTimerRef.current) clearInterval(updateTimerRef.current);
     
     const intervalMs = intervalMinutes * 60 * 1000;
     
     const nextUpdateTime = new Date(Date.now() + intervalMs).toISOString();
     setSettings(prev => ({ ...prev, nextUpdate: nextUpdateTime }));
     saveSetting("noip_next_update", nextUpdateTime);
     
     updateTimerRef.current = setInterval(async () => {
       console.log("Auto-updating DDNS...");
       await performIPUpdate();
       
       const newNextUpdate = new Date(Date.now() + intervalMs).toISOString();
       setSettings(prev => ({ ...prev, nextUpdate: newNextUpdate }));
       saveSetting("noip_next_update", newNextUpdate);
     }, intervalMs);
   }, [performIPUpdate, saveSetting]);
 
   const stopAutoUpdateTimer = useCallback(() => {
     if (updateTimerRef.current) {
       clearInterval(updateTimerRef.current);
       updateTimerRef.current = null;
     }
     setTimeUntilUpdate("");
   }, []);
 
   const updateCountdown = useCallback(() => {
     setSettings(prev => {
       if (!prev.nextUpdate) {
         setTimeUntilUpdate("");
         return prev;
       }
       const next = new Date(prev.nextUpdate).getTime();
       const now = Date.now();
       const diff = next - now;
       
       if (diff <= 0) {
         setTimeUntilUpdate("Updating...");
         return prev;
       }
       
       const minutes = Math.floor(diff / 60000);
       const seconds = Math.floor((diff % 60000) / 1000);
       setTimeUntilUpdate(`${minutes}m ${seconds}s`);
       return prev;
     });
   }, []);
 
   useEffect(() => {
     const fetchSettings = async () => {
       try {
         const { data, error } = await supabase
           .from("server_settings")
           .select("setting_key, setting_value")
           .in("setting_key", [
             "ddns_provider",
             "noip_enabled",
             "noip_username",
             "noip_password",
             "ddns_token",
             "noip_hostname",
             "ddns_zone_id",
             "ddns_custom_url",
             "noip_last_update",
             "noip_last_ip",
             "noip_update_interval",
             "noip_auto_update_enabled",
             "noip_next_update",
           ]);
 
         if (error) throw error;
 
         const newSettings: Partial<DDNSSettings> = {};
         data?.forEach((row) => {
           switch (row.setting_key) {
             case "ddns_provider":
               newSettings.provider = row.setting_value || "noip";
               break;
             case "noip_enabled":
               newSettings.enabled = row.setting_value === "true";
               break;
             case "noip_username":
               newSettings.username = row.setting_value;
               break;
             case "noip_password":
               newSettings.password = row.setting_value;
               break;
             case "ddns_token":
               newSettings.token = row.setting_value;
               break;
             case "noip_hostname":
               newSettings.hostname = row.setting_value;
               break;
             case "ddns_zone_id":
               newSettings.zoneId = row.setting_value;
               break;
             case "ddns_custom_url":
               newSettings.customUrl = row.setting_value;
               break;
             case "noip_last_update":
               newSettings.lastUpdate = row.setting_value;
               break;
             case "noip_last_ip":
               newSettings.lastIP = row.setting_value;
               break;
             case "noip_update_interval":
               newSettings.updateInterval = parseInt(row.setting_value) || 30;
               break;
             case "noip_auto_update_enabled":
               newSettings.autoUpdateEnabled = row.setting_value === "true";
               break;
             case "noip_next_update":
               newSettings.nextUpdate = row.setting_value || null;
               break;
           }
         });
 
         setSettings((prev) => ({ ...prev, ...newSettings }));
       } catch (error) {
         console.error("Error fetching DDNS settings:", error);
         toast.error("Failed to load DDNS settings");
       } finally {
         setLoading(false);
       }
     };
 
     fetchSettings();
     fetchCurrentIP();
     
     return () => {
       if (updateTimerRef.current) clearInterval(updateTimerRef.current);
       if (countdownRef.current) clearInterval(countdownRef.current);
     };
   }, []);
 
   useEffect(() => {
     if (settings.autoUpdateEnabled && settings.enabled && settings.hostname) {
       startAutoUpdateTimer(settings.updateInterval);
     } else {
       stopAutoUpdateTimer();
     }
     return () => {
       if (updateTimerRef.current) clearInterval(updateTimerRef.current);
     };
   }, [settings.autoUpdateEnabled, settings.enabled, settings.hostname, settings.updateInterval, startAutoUpdateTimer, stopAutoUpdateTimer]);
 
   useEffect(() => {
     if (settings.nextUpdate && settings.autoUpdateEnabled) {
       updateCountdown();
       countdownRef.current = setInterval(updateCountdown, 1000);
     } else {
       setTimeUntilUpdate("");
     }
     return () => {
       if (countdownRef.current) clearInterval(countdownRef.current);
     };
   }, [settings.nextUpdate, settings.autoUpdateEnabled, updateCountdown]);
 
   useEffect(() => {
     validateHostname(settings.hostname, settings.provider);
   }, [settings.hostname, settings.provider, validateHostname]);
 
   const handleSave = async () => {
     if (hostnameError) {
       toast.error("Please fix hostname format before saving");
       return;
     }
     
     setSaving(true);
     try {
       await Promise.all([
         saveSetting("ddns_provider", settings.provider),
         saveSetting("noip_enabled", settings.enabled.toString()),
         saveSetting("noip_username", settings.username),
         saveSetting("noip_password", settings.password),
         saveSetting("ddns_token", settings.token),
         saveSetting("noip_hostname", settings.hostname),
         saveSetting("ddns_zone_id", settings.zoneId),
         saveSetting("ddns_custom_url", settings.customUrl),
         saveSetting("noip_update_interval", settings.updateInterval.toString()),
         saveSetting("noip_auto_update_enabled", settings.autoUpdateEnabled.toString()),
       ]);
 
       await supabase.from("audit_logs").insert({
         user_id: user?.id,
         action: "UPDATE",
         resource_type: "ddns_settings",
         details: { 
           provider: settings.provider,
           hostname: settings.hostname, 
           enabled: settings.enabled,
           autoUpdate: settings.autoUpdateEnabled,
           interval: settings.updateInterval,
         },
       });
 
       toast.success("DDNS settings saved successfully");
     } catch (error) {
       console.error("Error saving DDNS settings:", error);
       toast.error("Failed to save DDNS settings");
     } finally {
       setSaving(false);
     }
   };
 
   const handleUpdateIP = async () => {
     if (!settings.hostname) {
       toast.error("Please configure hostname first");
       return;
     }
     
     const provider = DDNS_PROVIDERS.find(p => p.id === settings.provider);
     if (provider?.requiresUsername && !settings.username) {
       toast.error("Please configure username");
       return;
     }
     if (provider?.requiresPassword && !settings.password) {
       toast.error("Please configure password");
       return;
     }
     if (provider?.supportsToken && !provider.requiresUsername && !settings.token) {
       toast.error("Please configure API token");
       return;
     }
 
     setUpdating(true);
     try {
       const newIP = await performIPUpdate();
       toast.success(`IP updated to ${newIP}`);
       
       if (settings.autoUpdateEnabled) {
         startAutoUpdateTimer(settings.updateInterval);
       }
     } catch (error) {
       console.error("Error updating IP:", error);
       const message = error instanceof Error ? error.message : "Failed to update IP";
       toast.error(message);
     } finally {
       setUpdating(false);
     }
   };
 
   const toggleAutoUpdate = (enabled: boolean) => {
     setSettings(prev => ({ ...prev, autoUpdateEnabled: enabled }));
     if (enabled) {
       toast.success(`Auto-update enabled (every ${settings.updateInterval} minutes)`);
     } else {
       toast.info("Auto-update disabled");
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
               <Globe className="h-6 w-6 text-primary" />
               <div>
                 <CardTitle>Dynamic DNS</CardTitle>
                 <CardDescription>
                   Keep your domain updated with your public IP address
                 </CardDescription>
               </div>
             </div>
             <div className="flex items-center gap-2">
               <Label htmlFor="ddns-enabled">Enable</Label>
               <Switch
                 id="ddns-enabled"
                 checked={settings.enabled}
                 onCheckedChange={(checked) =>
                   setSettings((prev) => ({ ...prev, enabled: checked }))
                 }
               />
             </div>
           </div>
         </CardHeader>
         <CardContent className="space-y-6">
           {/* Provider Selection */}
           <div className="space-y-2">
             <Label>DDNS Provider</Label>
             <Select
               value={settings.provider}
               onValueChange={(value) => {
                 setSettings(prev => ({ ...prev, provider: value, hostname: "" }));
                 setHostnameError(null);
               }}
             >
               <SelectTrigger>
                 <SelectValue placeholder="Select provider" />
               </SelectTrigger>
               <SelectContent>
                 {DDNS_PROVIDERS.map((provider) => (
                   <SelectItem key={provider.id} value={provider.id}>
                     <div className="flex items-center gap-2">
                       <span>{provider.name}</span>
                       {provider.id === "duckdns" && (
                         <Badge variant="outline" className="text-xs">Free</Badge>
                       )}
                       {provider.id === "cloudflare" && (
                         <Badge variant="outline" className="text-xs">Pro</Badge>
                       )}
                     </div>
                   </SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>
 
           {/* Current Status */}
           <div className="grid gap-4 md:grid-cols-4">
             <div className="rounded-lg border border-border p-4">
               <p className="text-xs text-muted-foreground mb-1">Current Public IP</p>
               <p className="text-lg font-mono font-semibold text-foreground">
                 {currentIP || "Fetching..."}
               </p>
             </div>
             <div className="rounded-lg border border-border p-4">
               <p className="text-xs text-muted-foreground mb-1">Last Updated IP</p>
               <div className="flex items-center gap-2">
                 <p className="text-lg font-mono font-semibold text-foreground">
                   {settings.lastIP || "Never"}
                 </p>
                 {settings.lastIP === currentIP && currentIP && (
                   <CheckCircle className="h-4 w-4 text-success" />
                 )}
                 {settings.lastIP && settings.lastIP !== currentIP && currentIP && (
                   <AlertCircle className="h-4 w-4 text-warning" />
                 )}
               </div>
             </div>
             <div className="rounded-lg border border-border p-4">
               <p className="text-xs text-muted-foreground mb-1">Last Update</p>
               <p className="text-lg font-mono font-semibold text-foreground">
                 {settings.lastUpdate
                   ? new Date(settings.lastUpdate).toLocaleString()
                   : "Never"}
               </p>
             </div>
             <div className="rounded-lg border border-border p-4">
               <p className="text-xs text-muted-foreground mb-1">Auto-Update Status</p>
               <div className="flex items-center gap-2">
                 {settings.autoUpdateEnabled ? (
                   <>
                     <Badge variant="default" className="bg-success">
                       <Clock className="h-3 w-3 mr-1" />
                       Active
                     </Badge>
                     {timeUntilUpdate && (
                       <span className="text-sm text-muted-foreground">
                         Next: {timeUntilUpdate}
                       </span>
                     )}
                   </>
                 ) : (
                   <Badge variant="secondary">Disabled</Badge>
                 )}
               </div>
             </div>
           </div>
 
           {/* Configuration - Dynamic based on provider */}
           <div className="grid gap-4 md:grid-cols-2">
             {currentProvider.requiresUsername && (
               <div className="space-y-2">
                 <Label htmlFor="ddns-username">{currentProvider.name} Username/Email</Label>
                 <Input
                   id="ddns-username"
                   type="email"
                   placeholder="your@email.com"
                   value={settings.username}
                   onChange={(e) =>
                     setSettings((prev) => ({ ...prev, username: e.target.value }))
                   }
                 />
               </div>
             )}
             
             {currentProvider.requiresPassword && (
               <div className="space-y-2">
                 <Label htmlFor="ddns-password">{currentProvider.name} Password</Label>
                 <div className="relative">
                   <Input
                     id="ddns-password"
                     type={showPassword ? "text" : "password"}
                     placeholder="••••••••"
                     value={settings.password}
                     onChange={(e) =>
                       setSettings((prev) => ({ ...prev, password: e.target.value }))
                     }
                   />
                   <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                     onClick={() => setShowPassword(!showPassword)}
                   >
                     {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                   </Button>
                 </div>
               </div>
             )}
             
             {currentProvider.supportsToken && (
               <div className="space-y-2">
                 <Label htmlFor="ddns-token">
                   {settings.provider === "cloudflare" ? "API Token" : "Token/Key"}
                 </Label>
                 <div className="relative">
                   <Input
                     id="ddns-token"
                     type={showToken ? "text" : "password"}
                     placeholder="Your API token"
                     value={settings.token}
                     onChange={(e) =>
                       setSettings((prev) => ({ ...prev, token: e.target.value }))
                     }
                   />
                   <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                     onClick={() => setShowToken(!showToken)}
                   >
                     {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                   </Button>
                 </div>
               </div>
             )}
             
             {settings.provider === "cloudflare" && (
               <div className="space-y-2">
                 <Label htmlFor="ddns-zoneid">Zone ID</Label>
                 <Input
                   id="ddns-zoneid"
                   placeholder="Your Cloudflare Zone ID"
                   value={settings.zoneId}
                   onChange={(e) =>
                     setSettings((prev) => ({ ...prev, zoneId: e.target.value }))
                   }
                 />
               </div>
             )}
             
             <div className="space-y-2">
               <Label htmlFor="ddns-hostname">Hostname</Label>
               <Input
                 id="ddns-hostname"
                 placeholder={currentProvider.hostnameExample}
                 value={settings.hostname}
                 onChange={(e) =>
                   setSettings((prev) => ({ ...prev, hostname: e.target.value }))
                 }
                 className={hostnameError ? "border-destructive" : ""}
               />
               {hostnameError && (
                 <p className="text-xs text-destructive">{hostnameError}</p>
               )}
               {!hostnameError && settings.hostname && (
                 <p className="text-xs text-success flex items-center gap-1">
                   <CheckCircle className="h-3 w-3" />
                   Valid hostname format
                 </p>
               )}
             </div>
             
             {settings.provider === "custom" && (
               <div className="space-y-2 md:col-span-2">
                 <Label htmlFor="ddns-customurl">Custom Update URL</Label>
                 <Input
                   id="ddns-customurl"
                   placeholder="https://your-ddns-provider.com/update?hostname={hostname}&myip={ip}"
                   value={settings.customUrl}
                   onChange={(e) =>
                     setSettings((prev) => ({ ...prev, customUrl: e.target.value }))
                   }
                 />
                 <p className="text-xs text-muted-foreground">
                   Variables: {"{hostname}"}, {"{ip}"}, {"{username}"}, {"{password}"}, {"{token}"}
                 </p>
               </div>
             )}
             
             <div className="space-y-2">
               <Label htmlFor="ddns-interval">Update Interval (minutes)</Label>
               <Input
                 id="ddns-interval"
                 type="number"
                 min={5}
                 max={1440}
                 value={settings.updateInterval}
                 onChange={(e) =>
                   setSettings((prev) => ({
                     ...prev,
                     updateInterval: parseInt(e.target.value) || 30,
                   }))
                 }
               />
             </div>
           </div>
 
           {/* Hostname format help */}
           {currentProvider.domains.length > 0 && (
             <Alert>
               <Info className="h-4 w-4" />
               <AlertDescription>
                 <strong>{currentProvider.name}</strong> supports these domains:{" "}
                 {currentProvider.domains.map((d, i) => (
                   <span key={d}>
                     <code className="bg-muted px-1 rounded text-xs">.{d}</code>
                     {i < currentProvider.domains.length - 1 && ", "}
                   </span>
                 ))}
               </AlertDescription>
             </Alert>
           )}
 
           {/* Auto-Update Toggle */}
           <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-muted/50">
             <div className="flex items-center gap-3">
               <Clock className="h-5 w-5 text-primary" />
               <div>
                 <p className="font-medium">Automatic IP Updates</p>
                 <p className="text-sm text-muted-foreground">
                   Automatically update your IP every {settings.updateInterval} minutes
                 </p>
               </div>
             </div>
             <div className="flex items-center gap-2">
               <Button
                 variant="ghost"
                 size="icon"
                 onClick={() => toggleAutoUpdate(!settings.autoUpdateEnabled)}
                 disabled={!settings.enabled || !settings.hostname}
               >
                 {settings.autoUpdateEnabled ? (
                   <Pause className="h-4 w-4" />
                 ) : (
                   <Play className="h-4 w-4" />
                 )}
               </Button>
               <Switch
                 checked={settings.autoUpdateEnabled}
                 onCheckedChange={toggleAutoUpdate}
                 disabled={!settings.enabled || !settings.hostname}
               />
             </div>
           </div>
 
           {/* Actions */}
           <div className="flex items-center justify-between pt-4 border-t border-border">
             {currentProvider.website && (
               <a
                 href={currentProvider.website}
                 target="_blank"
                 rel="noopener noreferrer"
                 className="flex items-center gap-2 text-sm text-primary hover:underline"
               >
                 <ExternalLink className="h-4 w-4" />
                 Visit {currentProvider.name}
               </a>
             )}
             <div className="flex items-center gap-2 ml-auto">
               <Button
                 variant="outline"
                 onClick={handleUpdateIP}
                 disabled={updating || !settings.hostname || !!hostnameError}
               >
                 {updating ? (
                   <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                 ) : (
                   <RefreshCw className="mr-2 h-4 w-4" />
                 )}
                 Update IP Now
               </Button>
               <Button onClick={handleSave} disabled={saving || !!hostnameError}>
                 {saving ? (
                   <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                 ) : (
                   <Save className="mr-2 h-4 w-4" />
                 )}
                 Save Settings
               </Button>
             </div>
           </div>
         </CardContent>
       </Card>
 
       {/* Provider-specific Instructions */}
       <Card>
         <CardHeader>
           <CardTitle className="text-base">
             {currentProvider.name} Setup Instructions
           </CardTitle>
         </CardHeader>
         <CardContent className="space-y-3 text-sm text-muted-foreground">
           {currentProvider.instructions.map((instruction, index) => (
             <p key={index}>
               {index + 1}. {instruction}
             </p>
           ))}
         </CardContent>
       </Card>
 
       {/* Provider Comparison */}
       <Card>
         <CardHeader>
           <CardTitle className="text-base">Provider Comparison</CardTitle>
           <CardDescription>Choose the best provider for your needs</CardDescription>
         </CardHeader>
         <CardContent>
           <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
             {DDNS_PROVIDERS.filter(p => p.id !== "custom").map((provider) => (
               <div
                 key={provider.id}
                 className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                   settings.provider === provider.id
                     ? "border-primary bg-primary/5"
                     : "border-border hover:border-primary/50"
                 }`}
                 onClick={() => {
                   setSettings(prev => ({ ...prev, provider: provider.id, hostname: "" }));
                   setHostnameError(null);
                 }}
               >
                 <div className="flex items-center justify-between mb-2">
                   <span className="font-medium">{provider.name}</span>
                   {settings.provider === provider.id && (
                     <CheckCircle className="h-4 w-4 text-primary" />
                   )}
                 </div>
                 <p className="text-xs text-muted-foreground">
                   {provider.id === "duckdns" && "100% free, no renewals needed"}
                   {provider.id === "noip" && "Popular, requires 30-day renewal"}
                   {provider.id === "dynu" && "Free, never expires"}
                   {provider.id === "freedns" && "Thousands of free domains"}
                   {provider.id === "cloudflare" && "Use your own domain"}
                 </p>
               </div>
             ))}
           </div>
          </CardContent>
        </Card>

        {/* Multiple Hostnames */}
        <DDNSMultiHostname />

        {/* Scheduled Updates (Cron) */}
        <DDNSCronSchedule />

        {/* Health Monitoring */}
        <DDNSHealthMonitor />

        {/* Update History */}
        <DDNSUpdateHistory />
      </div>
    );
  }
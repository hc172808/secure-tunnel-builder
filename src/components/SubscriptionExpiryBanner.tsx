import { useState, useEffect } from "react";
import { AlertTriangle, X, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function SubscriptionExpiryBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [expiringSub, setExpiringSub] = useState<{ expires_at: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    const check = async () => {
      const warningDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("user_subscriptions")
        .select("expires_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .not("expires_at", "is", null)
        .lte("expires_at", warningDate)
        .order("expires_at", { ascending: true })
        .limit(1);
      if (data && data.length > 0) setExpiringSub(data[0]);
    };
    check();
  }, [user]);

  if (!expiringSub || dismissed) return null;

  const expiresAt = new Date(expiringSub.expires_at!);
  const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)));

  return (
    <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center gap-3">
      <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
      <p className="text-sm text-foreground flex-1">
        Your subscription expires in <strong>{hoursLeft}h</strong>. Renew to keep your peers active.
      </p>
      <Button size="sm" variant="outline" onClick={() => navigate("/subscriptions")}>
        <CreditCard className="mr-1 h-3 w-3" /> Renew
      </Button>
      <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

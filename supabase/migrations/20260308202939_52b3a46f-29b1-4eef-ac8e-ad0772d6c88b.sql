
-- Create bandwidth_alerts table for configurable thresholds
CREATE TABLE public.bandwidth_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_id uuid REFERENCES public.wireguard_peers(id) ON DELETE CASCADE NOT NULL,
  threshold_bytes bigint NOT NULL DEFAULT 1073741824,
  period_hours integer NOT NULL DEFAULT 24,
  enabled boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.bandwidth_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage bandwidth alerts"
  ON public.bandwidth_alerts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Create bandwidth_alert_logs to track triggered alerts
CREATE TABLE public.bandwidth_alert_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid REFERENCES public.bandwidth_alerts(id) ON DELETE CASCADE NOT NULL,
  peer_id uuid REFERENCES public.wireguard_peers(id) ON DELETE CASCADE NOT NULL,
  peer_name text NOT NULL,
  threshold_bytes bigint NOT NULL,
  actual_bytes bigint NOT NULL,
  period_hours integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bandwidth_alert_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view alert logs"
  ON public.bandwidth_alert_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert alert logs"
  ON public.bandwidth_alert_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE TRIGGER trg_bandwidth_alerts_updated_at
  BEFORE UPDATE ON public.bandwidth_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

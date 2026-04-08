
-- Usage-based billing: bandwidth rate tiers
CREATE TABLE public.bandwidth_rate_tiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  min_gb NUMERIC NOT NULL DEFAULT 0,
  max_gb NUMERIC,
  rate_per_gb NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GYD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.bandwidth_rate_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage rate tiers" ON public.bandwidth_rate_tiers
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view active rate tiers" ON public.bandwidth_rate_tiers
  FOR SELECT TO authenticated USING (is_active = true);

-- Usage billing records per user per billing cycle
CREATE TABLE public.usage_billing_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  peer_id UUID REFERENCES public.wireguard_peers(id) ON DELETE SET NULL,
  billing_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  billing_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  total_gb NUMERIC GENERATED ALWAYS AS (total_bytes::numeric / 1073741824.0) STORED,
  amount_due NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GYD',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage usage billing" ON public.usage_billing_records
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own billing" ON public.usage_billing_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- GYD Validator Nodes
CREATE TABLE public.gyd_validator_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'lite',
  endpoint_url TEXT NOT NULL,
  api_key TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_health_check TIMESTAMP WITH TIME ZONE,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  priority INTEGER NOT NULL DEFAULT 1,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.gyd_validator_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage validator nodes" ON public.gyd_validator_nodes
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Payment validation logs
CREATE TABLE public.payment_validation_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID REFERENCES public.crypto_payments(id) ON DELETE CASCADE,
  validator_node_id UUID REFERENCES public.gyd_validator_nodes(id) ON DELETE SET NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  block_number BIGINT,
  confirmations INTEGER DEFAULT 0,
  response_data JSONB,
  validated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_validation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage validation logs" ON public.payment_validation_logs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own validation logs" ON public.payment_validation_logs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.crypto_payments cp
      WHERE cp.id = payment_validation_logs.payment_id
      AND cp.user_id = auth.uid()
    )
  );

-- Add billing_type to subscription_plans
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'per_peer';

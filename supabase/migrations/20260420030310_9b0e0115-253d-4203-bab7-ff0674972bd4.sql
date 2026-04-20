CREATE TABLE public.validator_health_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  validator_node_id UUID NOT NULL REFERENCES public.gyd_validator_nodes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  block_number BIGINT,
  error_message TEXT,
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_validator_health_history_node_time
  ON public.validator_health_history (validator_node_id, checked_at DESC);

ALTER TABLE public.validator_health_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view health history"
ON public.validator_health_history FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage health history"
ON public.validator_health_history FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert health history"
ON public.validator_health_history FOR INSERT TO authenticated
WITH CHECK (true);
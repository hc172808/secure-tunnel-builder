
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS speed_limit_mbps integer DEFAULT NULL;

COMMENT ON COLUMN public.subscription_plans.speed_limit_mbps IS 'Bandwidth speed limit in Mbps for this plan tier. NULL means unlimited.';

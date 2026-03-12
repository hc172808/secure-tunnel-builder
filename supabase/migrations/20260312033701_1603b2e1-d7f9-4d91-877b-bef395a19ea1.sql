
-- Add duration_hours to subscription_plans (configurable per plan)
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS duration_hours integer DEFAULT 720;

-- Add expiry_notified_at to user_subscriptions to track when we sent expiry warning
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS expiry_notified_at timestamp with time zone DEFAULT NULL;

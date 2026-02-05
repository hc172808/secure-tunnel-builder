-- Create email notification logs table
CREATE TABLE public.email_notification_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  peer_id UUID REFERENCES public.wireguard_peers(id) ON DELETE SET NULL,
  peer_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.email_notification_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view all logs
CREATE POLICY "Admins can view email logs"
ON public.email_notification_logs
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete logs
CREATE POLICY "Admins can delete email logs"
ON public.email_notification_logs
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- System can insert logs
CREATE POLICY "System can insert email logs"
ON public.email_notification_logs
FOR INSERT
WITH CHECK (true);

-- Add index for faster queries
CREATE INDEX idx_email_notification_logs_created_at ON public.email_notification_logs(created_at DESC);
CREATE INDEX idx_email_notification_logs_status ON public.email_notification_logs(status);
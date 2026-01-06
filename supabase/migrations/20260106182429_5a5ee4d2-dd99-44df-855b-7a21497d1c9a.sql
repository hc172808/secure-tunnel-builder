-- Create invitations table
CREATE TABLE public.invitations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by UUID,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create pending peer requests table (for API-created peers that need approval)
CREATE TABLE public.pending_peer_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    public_key TEXT,
    allowed_ips TEXT NOT NULL DEFAULT '10.0.0.0/24',
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create peer_notifications table for real-time alerts
CREATE TABLE public.peer_notifications (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    peer_id UUID,
    peer_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add API token field to profiles for script authentication
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex');

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_peer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_notifications ENABLE ROW LEVEL SECURITY;

-- Invitations policies (admin only)
CREATE POLICY "Admins can manage invitations" ON public.invitations
    FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Pending peer requests policies
CREATE POLICY "Admins can manage all peer requests" ON public.pending_peer_requests
    FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own requests" ON public.pending_peer_requests
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own requests" ON public.pending_peer_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Peer notifications policies
CREATE POLICY "Admins can view all notifications" ON public.peer_notifications
    FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update notifications" ON public.peer_notifications
    FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert notifications" ON public.peer_notifications
    FOR INSERT WITH CHECK (true);

-- Trigger for updating updated_at on pending_peer_requests
CREATE TRIGGER update_pending_peer_requests_updated_at
    BEFORE UPDATE ON public.pending_peer_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for peer_notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.peer_notifications;
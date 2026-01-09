-- Create peer_groups table for organizing peers
CREATE TABLE public.peer_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Add group_id column to wireguard_peers
ALTER TABLE public.wireguard_peers 
ADD COLUMN group_id UUID REFERENCES public.peer_groups(id) ON DELETE SET NULL;

-- Enable RLS on peer_groups
ALTER TABLE public.peer_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies for peer_groups
CREATE POLICY "Admins can manage peer groups" 
ON public.peer_groups 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view peer groups" 
ON public.peer_groups 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Create index for faster group lookups
CREATE INDEX idx_wireguard_peers_group_id ON public.wireguard_peers(group_id);

-- Add some default groups
INSERT INTO public.peer_groups (name, color, description) VALUES
('Mobile', '#22c55e', 'Mobile devices like phones and tablets'),
('Servers', '#3b82f6', 'Server infrastructure'),
('Employees', '#f59e0b', 'Employee devices'),
('IoT', '#8b5cf6', 'Internet of Things devices');
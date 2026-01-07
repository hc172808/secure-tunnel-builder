-- Add is_disabled column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- Create firewall_rules table
CREATE TABLE IF NOT EXISTS public.firewall_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    source_ip TEXT,
    destination_ip TEXT,
    protocol TEXT DEFAULT 'any',
    port TEXT,
    action TEXT DEFAULT 'allow',
    priority INTEGER DEFAULT 100,
    enabled BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on firewall_rules
ALTER TABLE public.firewall_rules ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for firewall_rules
CREATE POLICY "Admins can manage firewall rules"
ON public.firewall_rules
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for priority ordering
CREATE INDEX IF NOT EXISTS idx_firewall_rules_priority ON public.firewall_rules(priority);
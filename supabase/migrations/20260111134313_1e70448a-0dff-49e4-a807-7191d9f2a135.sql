-- Add node subdomain settings and DNS hostname tracking
ALTER TABLE public.wireguard_peers 
ADD COLUMN IF NOT EXISTS subdomain text,
ADD COLUMN IF NOT EXISTS hostname text;

-- Create index for subdomain lookups
CREATE INDEX IF NOT EXISTS idx_wireguard_peers_subdomain ON public.wireguard_peers(subdomain);

-- Insert default domain settings into server_settings if they don't exist
INSERT INTO public.server_settings (setting_key, setting_value, description)
VALUES 
  ('node_domain_enabled', 'false', 'Enable automatic subdomain assignment for nodes'),
  ('node_base_domain', '', 'Base domain for node subdomains (e.g., nodes.example.com)'),
  ('node_ip_range_start', '10.0.0.2', 'Starting IP address for node assignment'),
  ('node_ip_range_end', '10.0.0.254', 'Ending IP address for node assignment'),
  ('noip_auto_update_enabled', 'false', 'Enable automatic NoIP updates on schedule'),
  ('noip_next_update', '', 'Next scheduled NoIP update timestamp')
ON CONFLICT (setting_key) DO NOTHING;
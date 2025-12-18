-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- Create wireguard_peers table
CREATE TABLE public.wireguard_peers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  private_key TEXT,
  allowed_ips TEXT NOT NULL DEFAULT '10.0.0.0/24',
  endpoint TEXT,
  dns TEXT DEFAULT '1.1.1.1',
  persistent_keepalive INTEGER DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'pending')),
  last_handshake TIMESTAMP WITH TIME ZONE,
  transfer_rx BIGINT DEFAULT 0,
  transfer_tx BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create peer_assignments table
CREATE TABLE public.peer_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_id UUID REFERENCES public.wireguard_peers(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (peer_id, user_id)
);

-- Create audit_logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create server_settings table
CREATE TABLE public.server_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create traffic_stats table for historical data
CREATE TABLE public.traffic_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_id UUID REFERENCES public.wireguard_peers(id) ON DELETE CASCADE NOT NULL,
  rx_bytes BIGINT NOT NULL DEFAULT 0,
  tx_bytes BIGINT NOT NULL DEFAULT 0,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wireguard_peers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_stats ENABLE ROW LEVEL SECURITY;

-- Security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- User roles policies
CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- WireGuard peers policies
CREATE POLICY "Admins can manage all peers" ON public.wireguard_peers
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view assigned peers" ON public.wireguard_peers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.peer_assignments
      WHERE peer_id = wireguard_peers.id
        AND user_id = auth.uid()
    )
  );

-- Peer assignments policies
CREATE POLICY "Admins can manage peer assignments" ON public.peer_assignments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their own assignments" ON public.peer_assignments
  FOR SELECT USING (auth.uid() = user_id);

-- Audit logs policies
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- Server settings policies
CREATE POLICY "Admins can manage server settings" ON public.server_settings
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view server settings" ON public.server_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Traffic stats policies
CREATE POLICY "Admins can manage traffic stats" ON public.traffic_stats
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view traffic stats for assigned peers" ON public.traffic_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.peer_assignments
      WHERE peer_id = traffic_stats.peer_id
        AND user_id = auth.uid()
    )
  );

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'username',
    NEW.raw_user_meta_data ->> 'display_name'
  );
  
  -- Assign default user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

-- Trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_wireguard_peers_updated_at
  BEFORE UPDATE ON public.wireguard_peers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_server_settings_updated_at
  BEFORE UPDATE ON public.server_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default server settings
INSERT INTO public.server_settings (setting_key, setting_value, description) VALUES
  ('server_public_key', 'AbC123...xyz', 'WireGuard server public key'),
  ('server_endpoint', 'vpn.example.com:51820', 'Server endpoint address'),
  ('listen_port', '51820', 'WireGuard listen port'),
  ('interface_address', '10.0.0.1/24', 'Server interface address'),
  ('dns_servers', '1.1.1.1, 8.8.8.8', 'DNS servers for clients');

-- Enable realtime for traffic stats
ALTER PUBLICATION supabase_realtime ADD TABLE public.traffic_stats;
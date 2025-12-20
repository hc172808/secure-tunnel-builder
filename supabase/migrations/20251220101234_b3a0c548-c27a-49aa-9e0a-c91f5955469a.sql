-- Enable realtime on wireguard_peers only (traffic_stats already enabled)
ALTER PUBLICATION supabase_realtime ADD TABLE public.wireguard_peers;
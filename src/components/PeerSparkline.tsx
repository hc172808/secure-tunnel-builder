import { useEffect, useState } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface SparklinePoint {
  rx: number;
  tx: number;
}

interface PeerSparklineProps {
  peerId: string;
}

export function PeerSparkline({ peerId }: PeerSparklineProps) {
  const [data, setData] = useState<SparklinePoint[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: stats } = await supabase
        .from("traffic_stats")
        .select("rx_bytes, tx_bytes")
        .eq("peer_id", peerId)
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: true })
        .limit(48);

      if (stats && stats.length > 0) {
        setData(stats.map((s) => ({ rx: s.rx_bytes, tx: s.tx_bytes })));
      }
    };

    fetchData();
  }, [peerId]);

  if (data.length < 2) return null;

  return (
    <div className="h-8 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-rx-${peerId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`spark-tx-${peerId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="rx" stroke="hsl(var(--success))" strokeWidth={1.5} fill={`url(#spark-rx-${peerId})`} dot={false} />
          <Area type="monotone" dataKey="tx" stroke="hsl(var(--primary))" strokeWidth={1.5} fill={`url(#spark-tx-${peerId})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

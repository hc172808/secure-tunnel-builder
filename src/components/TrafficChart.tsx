import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface TrafficDataPoint {
  time: string;
  rx: number;
  tx: number;
}

interface TrafficChartProps {
  peerId?: string;
  className?: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

// Generate sample data for demo
const generateSampleData = (): TrafficDataPoint[] => {
  const data: TrafficDataPoint[] = [];
  const now = new Date();
  
  for (let i = 23; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    data.push({
      time: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      rx: Math.floor(Math.random() * 100000000) + 10000000,
      tx: Math.floor(Math.random() * 50000000) + 5000000,
    });
  }
  
  return data;
};

export function TrafficChart({ peerId, className = "" }: TrafficChartProps) {
  const [data, setData] = useState<TrafficDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // For demo, use sample data
    setData(generateSampleData());
    setLoading(false);

    // Set up realtime subscription for traffic stats
    if (peerId) {
      const channel = supabase
        .channel("traffic-stats")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "traffic_stats",
            filter: `peer_id=eq.${peerId}`,
          },
          (payload) => {
            const newPoint = payload.new as { rx_bytes: number; tx_bytes: number; recorded_at: string };
            setData((prev) => [
              ...prev.slice(1),
              {
                time: new Date(newPoint.recorded_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
                rx: newPoint.rx_bytes,
                tx: newPoint.tx_bytes,
              },
            ]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [peerId]);

  if (loading) {
    return (
      <div className={`h-[200px] rounded-lg bg-muted animate-pulse ${className}`} />
    );
  }

  return (
    <div className={`${className}`}>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="rxGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="txGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis 
            dataKey="time" 
            stroke="hsl(var(--muted-foreground))" 
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="hsl(var(--muted-foreground))" 
            fontSize={10}
            tickFormatter={(value) => formatBytes(value)}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(value: number, name: string) => [
              formatBytes(value),
              name === "rx" ? "↓ Received" : "↑ Sent",
            ]}
          />
          <Area
            type="monotone"
            dataKey="rx"
            stroke="hsl(var(--success))"
            strokeWidth={2}
            fill="url(#rxGradient)"
          />
          <Area
            type="monotone"
            dataKey="tx"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#txGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
      
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-success" />
          <span className="text-xs text-muted-foreground">Download</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Upload</span>
        </div>
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "connected" | "disconnected" | "pending";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
        status === "connected" && "bg-success/20 text-success",
        status === "disconnected" && "bg-destructive/20 text-destructive",
        status === "pending" && "bg-warning/20 text-warning",
        className
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connected" && "bg-success animate-pulse",
          status === "disconnected" && "bg-destructive",
          status === "pending" && "bg-warning animate-pulse"
        )}
      />
      <span className="capitalize">{status}</span>
    </div>
  );
}

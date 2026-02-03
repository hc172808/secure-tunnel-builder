import { useState, useEffect, useRef } from "react";
import { Globe, CheckCircle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DnsPropagationCheckerProps {
  hostname: string;
  expectedIp?: string;
  onComplete?: (success: boolean) => void;
  autoStart?: boolean;
}

interface CheckResult {
  timestamp: Date;
  success: boolean;
  resolvedIp?: string;
  error?: string;
}

export function DnsPropagationChecker({
  hostname,
  expectedIp,
  onComplete,
  autoStart = false,
}: DnsPropagationCheckerProps) {
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [maxAttempts] = useState(10);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "failed">("idle");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (autoStart && hostname) {
      startChecking();
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoStart, hostname]);

  const checkDns = async (): Promise<CheckResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("dns-validate", {
        body: { hostname, expectedIp },
      });

      if (error) {
        return {
          timestamp: new Date(),
          success: false,
          error: error.message,
        };
      }

      return {
        timestamp: new Date(),
        success: data.valid,
        resolvedIp: data.resolvedIp,
        error: data.error,
      };
    } catch (err) {
      return {
        timestamp: new Date(),
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  };

  const startChecking = async () => {
    if (!hostname) {
      toast.error("No hostname provided");
      return;
    }

    setChecking(true);
    setStatus("checking");
    setAttempts(0);
    setProgress(0);
    setResults([]);

    let attemptCount = 0;
    let successCount = 0;
    const requiredSuccesses = 3;

    const runCheck = async () => {
      attemptCount++;
      setAttempts(attemptCount);
      setProgress((attemptCount / maxAttempts) * 100);

      const result = await checkDns();
      setResults((prev) => [...prev, result]);

      if (result.success) {
        successCount++;
        if (successCount >= requiredSuccesses) {
          // DNS is fully propagated
          setStatus("success");
          setChecking(false);
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }
          toast.success(`DNS propagation complete for ${hostname}`);
          onComplete?.(true);
          return true;
        }
      } else {
        successCount = 0; // Reset on failure
      }

      if (attemptCount >= maxAttempts) {
        setStatus("failed");
        setChecking(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        toast.error(`DNS propagation check failed for ${hostname}`);
        onComplete?.(false);
        return false;
      }

      return null;
    };

    // Initial check
    const initialResult = await runCheck();
    if (initialResult !== null) return;

    // Continue checking every 5 seconds
    intervalRef.current = setInterval(async () => {
      const result = await runCheck();
      if (result !== null && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }, 5000);
  };

  const stopChecking = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    setChecking(false);
    setStatus("idle");
  };

  const getStatusIcon = () => {
    switch (status) {
      case "checking":
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "success":
        return <CheckCircle className="h-5 w-5 text-success" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Globe className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "checking":
        return `Checking DNS propagation... (${attempts}/${maxAttempts})`;
      case "success":
        return "DNS propagated successfully!";
      case "failed":
        return "DNS propagation check failed";
      default:
        return "Ready to check DNS propagation";
    }
  };

  return (
    <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <div>
            <p className="text-sm font-medium text-foreground">{getStatusText()}</p>
            <p className="text-xs text-muted-foreground">{hostname}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {checking ? (
            <Button variant="outline" size="sm" onClick={stopChecking}>
              Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={startChecking}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {status === "idle" ? "Start" : "Retry"}
            </Button>
          )}
        </div>
      </div>

      {checking && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Checking every 5 seconds... ({Math.ceil((maxAttempts - attempts) * 5)}s remaining)
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {results.slice(-5).map((result, index) => (
            <div
              key={index}
              className={`flex items-center justify-between text-xs p-1.5 rounded ${
                result.success ? "bg-success/10" : "bg-destructive/10"
              }`}
            >
              <span className="text-muted-foreground">
                {result.timestamp.toLocaleTimeString()}
              </span>
              <span className={result.success ? "text-success" : "text-destructive"}>
                {result.success
                  ? `✓ ${result.resolvedIp || "Resolved"}`
                  : `✗ ${result.error || "Not resolved"}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

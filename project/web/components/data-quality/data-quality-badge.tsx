"use client";
import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { ticker: string; showDetails?: boolean }

export function DataQualityBadge({ ticker, showDetails = false }: Props) {
  const { toast } = useToast();
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function load() {
    if (data || loading) return;
    setLoading(true);
    const res = await fetch(`/api/data-quality?ticker=${ticker}`);
    const d = await res.json();
    setLoading(false);
    if (res.ok) setData(d);
    else toast({ title: "Failed to load data quality", variant: "destructive" as any });
  }

  const score = data?.overallScore ?? null;
  const Icon = score === null ? Loader2 : score >= 80 ? ShieldCheck : score >= 50 ? AlertTriangle : XCircle;
  const color = score === null ? "" : score >= 80 ? "text-signal-positive" : score >= 50 ? "text-signal-amber" : "text-signal-negative";
  const variant = score === null ? "outline" : score >= 80 ? "positive" : score >= 50 ? "amber" : "negative";

  return (
    <Tooltip open={open} onOpenChange={v => { setOpen(v); if (v) load(); }}>
      <TooltipTrigger asChild>
        <button className="inline-flex items-center" onClick={() => { setOpen(true); load(); }}>
          <Badge variant={variant as any} className="gap-1 cursor-pointer text-[10px]">
            <Icon className={cn("h-3 w-3", loading && "animate-spin")} />
            {score !== null ? `${score}% data quality` : "Check quality"}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent className="w-72 p-3" side="bottom">
        {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
        {data && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{ticker} Data Quality</span>
              <span className={cn("font-mono text-xs font-bold", color)}>{data.overallScore}%</span>
            </div>
            <Progress value={data.overallScore} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground">{data.totalQuarters} quarters on file</p>
            {data.issues?.length > 0 && (
              <div className="space-y-1">
                {data.issues.slice(0, 3).map((issue: string, i: number) => (
                  <p key={i} className="text-[10px] text-signal-negative">⚠ {issue}</p>
                ))}
              </div>
            )}
            {showDetails && data.strategyReadiness && (
              <div className="space-y-1 border-t pt-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Strategy readiness</p>
                {Object.entries(data.strategyReadiness).map(([slug, ready]: [string, any]) => (
                  <div key={slug} className="flex items-center justify-between">
                    <span className="text-[10px] truncate">{slug.split("-").slice(0, 2).join(" ")}</span>
                    <span className={cn("text-[10px] font-mono", ready ? "text-signal-positive" : "text-signal-negative")}>{ready ? "Ready" : "Needs data"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

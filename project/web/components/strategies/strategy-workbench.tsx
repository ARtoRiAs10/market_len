"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Download } from "lucide-react";
import { StrategyResultPanel } from "@/components/strategies/strategy-result-panel";
import { AiAnalystPanel } from "@/components/ai-analyst/ai-analyst-panel";
import { DataQualityBadge } from "@/components/data-quality/data-quality-badge";

interface ParamDef { key: string; label: string; description?: string; type: string; defaultValue: any; min?: number; max?: number; step?: number; options?: { label: string; value: string }[]; unit?: string }
interface Company { ticker: string; name: string }

export function StrategyWorkbench({ strategySlug, parameters, companies, defaultTicker, minQuartersRequired }:
  { strategySlug: string; parameters: ParamDef[]; companies: Company[]; defaultTicker?: string; minQuartersRequired: number }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [ticker, setTicker] = React.useState(defaultTicker ?? companies[0]?.ticker ?? "");
  const [values, setValues] = React.useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    parameters.forEach(p => { init[p.key] = p.defaultValue; });
    return init;
  });
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  function setParam(key: string, value: any) { setValues(v => ({ ...v, [key]: value })); }
  function resetDefaults() {
    const init: Record<string, any> = {};
    parameters.forEach(p => { init[p.key] = p.defaultValue; });
    setValues(init);
  }

  async function run() {
    if (!ticker) { toast({ title: "Choose a company first", variant: "destructive" as any }); return; }
    setLoading(true); setError(null);
    const res = await fetch(`/api/strategies/${strategySlug}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, parameters: values }),
    });
    const data = await res.json(); setLoading(false);
    if (!res.ok) { setError(data.error ?? "Run failed"); toast({ title: "Run failed", description: data.error, variant: "destructive" as any }); return; }
    setResult(data.result);
    toast({ title: `${ticker} scored ${data.result.score}/100`, description: data.result.verdict });
  }

  function exportCsv() {
    if (!result) return;
    const rows = [["Criterion","Category","Pass","Value","Threshold","Weight"],
      ...result.criteria.map((c: any) => [c.label, c.category, c.pass, c.value, c.threshold, c.weight])];
    const csv = rows.map(r => r.map((cell: any) => `"${String(cell ?? "")}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${ticker}-${strategySlug}-result.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const isPro = (session?.user as any)?.plan !== "FREE";

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit">
        <CardHeader><CardTitle>Run configuration</CardTitle><CardDescription>Choose a company and tune parameters.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Select value={ticker} onValueChange={setTicker}>
              <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
              <SelectContent>
                {companies.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No companies in watchlist.</div>}
                {companies.map(c => <SelectItem key={c.ticker} value={c.ticker}><span className="font-mono">{c.ticker}</span> — {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Requires ≥ {minQuartersRequired} quarters.</p>
              {ticker && <DataQualityBadge ticker={ticker} showDetails />}
            </div>
          </div>

          <div className="space-y-5">
            {parameters.map(p => <ParamControl key={p.key} def={p} value={values[p.key]} onChange={v => setParam(p.key, v)} />)}
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={run} disabled={loading} className="flex-1">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run strategy
            </Button>
            <Button variant="outline" onClick={resetDefaults} disabled={loading}>Reset</Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {!result && (
          <Card><CardContent className="flex h-64 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Play className="h-6 w-6" />
            <p className="text-sm">Configure parameters and run the strategy to see results here.</p>
          </CardContent></Card>
        )}
        {result && (
          <>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
            </div>
            <StrategyResultPanel result={result} ticker={ticker} />
            <AiAnalystPanel ticker={ticker} strategySlug={strategySlug} parameters={values} isPro={isPro} />
          </>
        )}
      </div>
    </div>
  );
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: any; onChange: (v: any) => void }) {
  if (def.type === "slider") return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{def.label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{String(value)}{def.unit ?? ""}</span>
      </div>
      <Slider value={[Number(value)]} min={def.min} max={def.max} step={def.step} onValueChange={([v]) => onChange(v)} />
      {def.description && <p className="text-[11px] text-muted-foreground">{def.description}</p>}
    </div>
  );
  if (def.type === "select") return (
    <div className="space-y-1.5">
      <Label className="text-xs">{def.label}</Label>
      <Select value={String(value)} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{def.options?.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
      {def.description && <p className="text-[11px] text-muted-foreground">{def.description}</p>}
    </div>
  );
  if (def.type === "number") return (
    <div className="space-y-1.5">
      <Label className="text-xs">{def.label}</Label>
      <Input type="number" value={Number(value)} min={def.min} max={def.max} step={def.step ?? 0.1} onChange={e => onChange(parseFloat(e.target.value))} />
      {def.description && <p className="text-[11px] text-muted-foreground">{def.description}</p>}
    </div>
  );
  return null;
}

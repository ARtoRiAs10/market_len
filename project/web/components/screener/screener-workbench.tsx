"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatPercent } from "@/lib/utils";

interface StrategyParam { key: string; label: string; type: string; defaultValue: any; min?: number; max?: number; step?: number; options?: { label: string; value: string }[] }
interface StrategyDef { slug: string; name: string; category: string; parameters: StrategyParam[] }
interface Company { ticker: string; name: string; sector: string | null }
interface ScreenerResult {
  ticker: string; name: string; sector: string | null; status: string;
  score: number | null; verdict: string | null; verdictColor: string | null;
  rawScore: number | null; sectorMedianScore: number | null; relativeScore: number | null; summary?: string;
}

export function ScreenerWorkbench({ strategies, companies }: { strategies: StrategyDef[]; companies: Company[] }) {
  const { toast } = useToast();
  const [strategySlug, setStrategySlug] = React.useState(strategies[0]?.slug ?? "");
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<ScreenerResult[]>([]);
  const [sortBy, setSortBy] = React.useState<"score" | "relativeScore" | "ticker">("score");
  const [params, setParams] = React.useState<Record<string, any>>({});
  const selectedStrategy = strategies.find(s => s.slug === strategySlug);

  React.useEffect(() => {
    if (!selectedStrategy) return;
    const defaults: Record<string, any> = {};
    selectedStrategy.parameters.forEach(p => { defaults[p.key] = p.defaultValue; });
    setParams(defaults);
  }, [strategySlug]);

  async function run() {
    setLoading(true);
    const res = await fetch("/api/screener", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategySlug, parameters: params }) });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast({ title: "Screener failed", description: data.error, variant: "destructive" as any }); return; }
    setResults(data.results);
    toast({ title: `Screened ${data.results.length} companies` });
  }

  function exportCsv() {
    const rows = [["Ticker","Name","Sector","Score","Verdict","Sector Median","Relative Score"],
      ...sorted.map(r => [r.ticker, r.name, r.sector ?? "", r.score ?? "", r.verdict ?? "", r.sectorMedianScore ?? "", r.relativeScore ?? ""])];
    const blob = new Blob([rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `screener-${strategySlug}.csv`; a.click();
  }

  const sorted = [...results].sort((a, b) => {
    if (sortBy === "score") return (b.score ?? -1) - (a.score ?? -1);
    if (sortBy === "relativeScore") return (b.relativeScore ?? -999) - (a.relativeScore ?? -999);
    return a.ticker.localeCompare(b.ticker);
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Strategy</Label>
              <Select value={strategySlug} onValueChange={setStrategySlug}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {strategies.map(s => <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedStrategy?.parameters.slice(0, 3).map(p => (
              p.type === "slider" ? (
                <div key={p.key} className="space-y-1.5">
                  <div className="flex justify-between"><Label className="text-xs">{p.label}</Label><span className="font-mono text-xs text-muted-foreground">{params[p.key]}</span></div>
                  <Slider value={[params[p.key] ?? p.defaultValue]} min={p.min} max={p.max} step={p.step} onValueChange={([v]) => setParams(ps => ({ ...ps, [p.key]: v }))} />
                </div>
              ) : null
            ))}
            <Button onClick={run} disabled={loading || companies.length === 0} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Screen {companies.length} companies
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {results.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {(["score","relativeScore","ticker"] as const).map(k => (
                  <Button key={k} size="sm" variant={sortBy === k ? "default" : "outline"} onClick={() => setSortBy(k)}>
                    {k === "score" ? "By Score" : k === "relativeScore" ? "Sector-Relative" : "A–Z"}
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</Button>
            </div>
          )}

          {results.length === 0 && (
            <Card><CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Run the screener to rank all watchlist companies by strategy score.
            </CardContent></Card>
          )}

          {sorted.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-3 text-left font-medium">#</th>
                    <th className="p-3 text-left font-medium">Ticker</th>
                    <th className="p-3 text-left font-medium">Sector</th>
                    <th className="p-3 text-center font-medium">Score</th>
                    <th className="p-3 text-center font-medium">Verdict</th>
                    <th className="p-3 text-center font-medium">Sector Median</th>
                    <th className="p-3 text-center font-medium">vs Sector</th>
                  </tr></thead>
                  <tbody>
                    {sorted.map((r, i) => (
                      <tr key={r.ticker} className="border-b last:border-0 hover:bg-secondary/30">
                        <td className="p-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                        <td className="p-3">
                          <p className="font-mono font-semibold">{r.ticker}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[120px]">{r.name}</p>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{r.sector ?? "—"}</td>
                        <td className="p-3 text-center">
                          {r.score !== null ? (
                            <div className="flex items-center justify-center gap-2">
                              <div className="h-2 w-16 rounded-full bg-secondary overflow-hidden">
                                <div className={cn("h-full rounded-full", r.score >= 70 ? "bg-signal-positive" : r.score >= 45 ? "bg-signal-amber" : "bg-signal-negative")} style={{ width: `${r.score}%` }} />
                              </div>
                              <span className="font-mono text-xs font-semibold">{r.score}</span>
                            </div>
                          ) : <span className="text-xs text-muted-foreground">{r.status === "insufficient_data" ? "No data" : "—"}</span>}
                        </td>
                        <td className="p-3 text-center">
                          {r.verdict ? <Badge variant={r.verdictColor as any}>{r.verdict}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 text-center font-mono text-xs">{r.sectorMedianScore ?? "—"}</td>
                        <td className="p-3 text-center">
                          {r.relativeScore !== null ? (
                            <span className={cn("inline-flex items-center gap-1 font-mono text-xs", r.relativeScore > 0 ? "text-signal-positive" : r.relativeScore < 0 ? "text-signal-negative" : "text-muted-foreground")}>
                              {r.relativeScore > 0 ? <TrendingUp className="h-3 w-3" /> : r.relativeScore < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {r.relativeScore > 0 ? "+" : ""}{r.relativeScore.toFixed(0)}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

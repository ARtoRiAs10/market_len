"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";

interface Strategy { slug: string; name: string; category: string }
interface Company { ticker: string; name: string }

export function BacktestWorkbench({ strategies, companies }: { strategies: Strategy[]; companies: Company[] }) {
  const { toast } = useToast();
  const [strategySlug, setStrategySlug] = React.useState(strategies[0]?.slug ?? "");
  const [ticker, setTicker] = React.useState(companies[0]?.ticker ?? "");
  const [buyThresh, setBuyThresh] = React.useState(70);
  const [sellThresh, setSellThresh] = React.useState(45);
  const [windowSize, setWindowSize] = React.useState(8);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);

  async function run() {
    setLoading(true);
    const res = await fetch("/api/backtesting", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategySlug, ticker, strongBuyThreshold: buyThresh, weakSellThreshold: sellThresh, windowSize }) });
    const data = await res.json(); setLoading(false);
    if (!res.ok) { toast({ title: "Backtest failed", description: data.error, variant: "destructive" as any }); return; }
    setResult(data);
    toast({ title: "Backtest complete", description: `Portfolio: ${data.summary.finalPortfolioValue} vs BuyHold: ${data.summary.finalBuyHoldValue}` });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit">
        <CardHeader><CardTitle className="text-base">Backtest Config</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label className="text-xs">Strategy</Label>
            <Select value={strategySlug} onValueChange={setStrategySlug}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{strategies.map(s => <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Company</Label>
            <Select value={ticker} onValueChange={setTicker}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{companies.map(c => <SelectItem key={c.ticker} value={c.ticker}><span className="font-mono">{c.ticker}</span> — {c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><Label className="text-xs">Buy threshold</Label><span className="font-mono text-xs text-signal-positive">{buyThresh}/100</span></div>
            <Slider value={[buyThresh]} min={50} max={95} step={5} onValueChange={([v]) => setBuyThresh(v)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><Label className="text-xs">Sell threshold</Label><span className="font-mono text-xs text-signal-negative">{sellThresh}/100</span></div>
            <Slider value={[sellThresh]} min={10} max={65} step={5} onValueChange={([v]) => setSellThresh(v)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><Label className="text-xs">Evaluation window</Label><span className="font-mono text-xs">{windowSize}Q</span></div>
            <Slider value={[windowSize]} min={4} max={12} step={1} onValueChange={([v]) => setWindowSize(v)} />
          </div>
          <Button onClick={run} disabled={loading || !ticker} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run Backtest
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {!result && <Card><CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">Configure parameters and run backtest to see results.</CardContent></Card>}
        {result && (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              {[
                { label: "Portfolio return", value: `${result.summary.finalPortfolioValue}`, suffix: "/100" },
                { label: "Buy & hold return", value: `${result.summary.finalBuyHoldValue}`, suffix: "/100" },
                { label: "Outperformance", value: result.summary.outperformance > 0 ? `+${result.summary.outperformance}` : `${result.summary.outperformance}`, color: result.summary.outperformance > 0 ? "text-signal-positive" : "text-signal-negative" },
                { label: "Win rate (buy signals)", value: result.summary.winRate !== null ? `${result.summary.winRate}%` : "—" },
              ].map(m => (
                <Card key={m.label}><CardContent className="p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{m.label}</p>
                  <p className={cn("mt-1 font-mono text-xl font-semibold", m.color)}>{m.value}{m.suffix ?? ""}</p>
                </CardContent></Card>
              ))}
            </div>
            {result.risk && (
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  { label: "Annualised return", value: result.risk.annualisedReturn !== null ? `${(result.risk.annualisedReturn * 100).toFixed(1)}%` : "—" },
                  { label: "Sharpe", value: result.risk.sharpe !== null ? result.risk.sharpe.toFixed(2) : "—" },
                  { label: "Max drawdown", value: result.risk.maxDrawdown !== null ? `${(result.risk.maxDrawdown * 100).toFixed(1)}%` : "—", color: "text-signal-negative" },
                  { label: "Deflated Sharpe prob.", value: result.risk.deflatedSharpeProb !== null ? `${(result.risk.deflatedSharpeProb * 100).toFixed(0)}%` : "—" },
                ].map(m => (
                  <Card key={m.label}><CardContent className="p-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{m.label}</p>
                    <p className={cn("mt-1 font-mono text-lg font-semibold", m.color)}>{m.value}</p>
                  </CardContent></Card>
                ))}
              </div>
            )}
            {result.warnings && result.warnings.length > 0 && (
              <Card className="border-signal-amber/40 bg-signal-amber/5">
                <CardContent className="p-4 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Backtest warnings</p>
                  <ul className="mt-1 list-inside list-disc">
                    {result.warnings.map((w: string) => <li key={w}>{w}</li>)}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle className="text-base">Portfolio vs Buy-and-Hold (base 100)</CardTitle><CardDescription>Following strategy signals vs always being invested.</CardDescription></CardHeader>
              <CardContent><div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.portfolioSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="portfolio" stroke="hsl(var(--signal-positive))" strokeWidth={2} dot={false} name="Strategy Portfolio" />
                    <Line type="monotone" dataKey="buyHold" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="Buy & Hold" strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Signal History</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-muted-foreground uppercase tracking-wider">
                    {["Quarter","Score","Verdict","Signal","Entry","Exit","Return"].map(h => <th key={h} className="py-2 pr-4 text-left font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>{result.signals.map((s: any) => (
                    <tr key={s.label} className="border-b last:border-0 font-mono">
                      <td className="py-2 pr-4 font-sans">{s.label}</td>
                      <td className="py-2 pr-4">{s.score}</td>
                      <td className="py-2 pr-4"><Badge variant={s.verdict === "Strong" ? "positive" : s.verdict === "Weak" ? "negative" : "amber"} className="text-[10px]">{s.verdict}</Badge></td>
                      <td className="py-2 pr-4"><Badge variant={s.signal === "BUY" ? "positive" : s.signal === "SELL" ? "negative" : "outline"} className="text-[10px]">{s.signal}</Badge></td>
                      <td className="py-2 pr-4">{s.priceEntry ? `$${s.priceEntry.toFixed(2)}` : "—"}</td>
                      <td className="py-2 pr-4">{s.priceExit ? `$${s.priceExit.toFixed(2)}` : "—"}</td>
                      <td className={cn("py-2 pr-4", s.quarterReturn > 0 ? "text-signal-positive" : s.quarterReturn < 0 ? "text-signal-negative" : "")}>
                        {s.quarterReturn !== null ? `${s.quarterReturn > 0 ? "+" : ""}${(s.quarterReturn * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

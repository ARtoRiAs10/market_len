"use client";
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart, Bar, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from "recharts";
import { ArrowLeft, Download, Loader2, Save, Sparkles, Trash2 } from "lucide-react";

export interface StudioPosition {
  ticker: string;
  name: string;
  sector: string | null;
  shares: number;
  targetWeight: number | null;
  lastPrice: number | null;
  marketValue: number;
  weight: number;
  costBasis: number | null;
}

export interface StudioAnalytics {
  metrics: Record<string, number | null> & {
    observations: number;
    sharpeCI?: { lower: number; upper: number; point: number } | null;
  };
  equityCurve: { label: string; value: number; benchmark: number | null; drawdown: number }[];
  allocation: { ticker: string; name: string; sector: string | null; weight: number; marketValue: number }[];
  sectorAllocation: { sector: string; weight: number }[];
  riskContributions: { name: string; weight: number; percentOfRisk: number }[];
  correlation: { names: string[]; matrix: (number | null)[][] };
  attribution: {
    rows: { name: string; portfolioWeight: number; benchmarkWeight: number; allocation: number; selection: number; interaction: number; total: number }[];
    totals: { allocation: number; selection: number; interaction: number; activeReturn: number; benchmarkReturn: number; portfolioReturn: number };
    linkingCoefficient: number;
  } | null;
  frequency: "daily" | "quarterly";
  approximated: boolean;
  observations: number;
}

export interface OptimizationResult {
  method: string;
  assets: {
    symbol: string;
    sector: string;
    currentWeight: number;
    currentValue: number;
    expectedReturn: number;
    volatility: number;
    targetWeight: number;
  }[];
  expectedReturn: number;
  volatility: number;
  sharpe: number;
  diagnostics: { iterations: number; converged: boolean; shrinkageApplied: boolean; warnings: string[] };
  frequency: "daily" | "quarterly";
  observations: number;
  frontier: { expectedReturn: number; volatility: number; sharpe: number }[];
}

export interface StudioPayload {
  portfolio: {
    id: string;
    name: string;
    description: string | null;
    baseCurrency: string;
    benchmarkTicker: string | null;
    cashBalance: number;
    createdAt: string;
  };
  positions: StudioPosition[];
  totalValue: number;
  cashValue: number;
  analytics: StudioAnalytics;
}

const PIE_COLORS = [
  "hsl(var(--signal-positive))",
  "hsl(var(--signal-amber))",
  "hsl(210 70% 55%)",
  "hsl(280 60% 60%)",
  "hsl(0 70% 55%)",
  "hsl(180 55% 45%)",
  "hsl(320 55% 60%)",
  "hsl(45 80% 55%)",
];

const chartTooltip = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 12,
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-xl font-semibold">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Portfolio Studio — the read/write view of a single portfolio.
 *
 * Analytics come from `lib/portfolio/service` (server side) so the numbers
 * shown here are identical to the ones returned by `/api/portfolio/[id]`.
 */
export function PortfolioStudio({ data }: { data: StudioPayload }) {
  const { toast } = useToast();
  const [positions, setPositions] = React.useState<StudioPosition[]>(data.positions);
  const [shares, setShares] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [method, setMethod] = React.useState("max-sharpe");
  const [maxWeight, setMaxWeight] = React.useState(0.4);
  const [riskFree, setRiskFree] = React.useState(0.04);
  const [optimizing, setOptimizing] = React.useState(false);
  const [optimization, setOptimization] = React.useState<OptimizationResult | null>(null);

  const { analytics, portfolio } = data;
  const m = analytics.metrics;

  async function savePosition(ticker: string) {
    const value = Number(shares[ticker] ?? positions.find((p) => p.ticker === ticker)?.shares ?? 0);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: "Invalid share count", variant: "destructive" as any });
      return;
    }
    setSaving(ticker);
    const res = await fetch(`/api/portfolio/${portfolio.id}/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, shares: value }),
    });
    setSaving(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Could not save position", description: body.error, variant: "destructive" as any });
      return;
    }
    setPositions((prev) =>
      prev.map((p) => (p.ticker === ticker ? { ...p, shares: value } : p))
    );
    toast({ title: `${ticker} updated` });
    await refresh();
  }

  async function removePosition(ticker: string) {
    setSaving(ticker);
    const res = await fetch(`/api/portfolio/${portfolio.id}/positions?ticker=${ticker}`, { method: "DELETE" });
    setSaving(null);
    if (!res.ok) {
      toast({ title: "Could not remove position", variant: "destructive" as any });
      return;
    }
    setPositions((prev) => prev.filter((p) => p.ticker !== ticker));
    toast({ title: `${ticker} removed` });
    await refresh();
  }

  async function syncPrices() {
    const tickers = Array.from(
      new Set([...positions.map((p) => p.ticker), portfolio.benchmarkTicker].filter(Boolean) as string[])
    );
    if (tickers.length === 0) return;
    setSyncing(true);
    let synced = 0;
    const failures: string[] = [];
    for (const ticker of tickers) {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, days: 500 }),
      });
      if (res.ok) synced += 1;
      else failures.push(ticker);
    }
    setSyncing(false);
    if (failures.length > 0) {
      toast({
        title: `Synced ${synced}/${tickers.length} tickers`,
        description: `Failed: ${failures.join(", ")}`,
        variant: "destructive" as any,
      });
    } else {
      toast({ title: `Synced ${synced} price series` });
    }
    await refresh();
  }

  async function runOptimizer() {
    setOptimizing(true);
    const res = await fetch(`/api/portfolio/${portfolio.id}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, maxWeight, riskFreeRate: riskFree, longOnly: true }),
    });
    const body = await res.json().catch(() => ({}));
    setOptimizing(false);
    if (!res.ok) {
      toast({ title: "Optimisation failed", description: body.error, variant: "destructive" as any });
      return;
    }
    setOptimization(body);
  }

  async function refresh() {
    setRefreshing(true);
    const res = await fetch(`/api/portfolio/${portfolio.id}`);
    setRefreshing(false);
    if (!res.ok) return;
    // The router cache holds the server-rendered payload; a full reload keeps
    // the two views consistent after an edit.
    window.location.reload();
  }

  const hasBenchmark = analytics.equityCurve.some((p) => p.benchmark !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="mb-1 -ml-2" asChild>
            <Link href="/dashboard/portfolios"><ArrowLeft className="h-4 w-4" /> Portfolios</Link>
          </Button>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{portfolio.name}</h1>
          <p className="text-sm text-muted-foreground">
            {portfolio.description ?? "No description"} ·{" "}
            {analytics.frequency === "daily" ? "Daily bars" : "Quarterly closes (approximated)"}
            {analytics.approximated && (
              <Badge variant="amber" className="ml-2 text-[10px]">approximated series</Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {portfolio.benchmarkTicker && (
            <Badge variant="outline" className="font-mono">vs {portfolio.benchmarkTicker}</Badge>
          )}
          <Button variant="outline" size="sm" onClick={syncPrices} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Sync prices
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Market value" value={formatCurrency(data.totalValue, { currency: portfolio.baseCurrency })} hint={`${positions.length} positions + ${formatCurrency(data.cashValue, { currency: portfolio.baseCurrency })} cash`} />
        <Metric label="Total return" value={formatPercent(m.totalReturn)} hint={`CAGR ${formatPercent(m.cagr)}`} />
        <Metric label="Sharpe" value={m.sharpe !== null ? m.sharpe.toFixed(2) : "—"} hint={m.sharpeCI ? `95% CI ${m.sharpeCI.lower.toFixed(2)}–${m.sharpeCI.upper.toFixed(2)}` : `${analytics.observations} observations`} />
        <Metric label="Max drawdown" value={formatPercent(m.maxDrawdown)} hint={`vol ${formatPercent(m.annualisedVol)}`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Sortino" value={m.sortino !== null ? m.sortino.toFixed(2) : "—"} hint={`Calmar ${m.calmar !== null ? m.calmar.toFixed(2) : "—"}`} />
        <Metric label="Beta" value={m.beta !== null ? m.beta.toFixed(2) : "—"} hint={m.alpha !== null ? `alpha ${formatPercent(m.alpha)}` : "no benchmark"} />
        <Metric label="VaR 95% (1d)" value={formatPercent(m.var95Historical)} hint={`CVaR ${formatPercent(m.cvar95)}`} />
        <Metric label="Deflated Sharpe prob." value={m.deflatedSharpeProb !== null ? formatPercent(m.deflatedSharpeProb) : "—"} hint="after multiple testing" />
      </div>

      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="allocation">Allocation</TabsTrigger>
          <TabsTrigger value="risk">Risk</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="optimizer">Optimizer</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equity curve</CardTitle>
              <CardDescription>Indexed to 100{hasBenchmark ? ` compared with ${portfolio.benchmarkTicker}` : ""}.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                {analytics.equityCurve.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Not enough price history to plot an equity curve.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analytics.equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                      <Tooltip contentStyle={chartTooltip} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="value" stroke="hsl(var(--signal-positive))" strokeWidth={2} dot={false} name="Portfolio" />
                      {hasBenchmark && (
                        <Line type="monotone" dataKey="benchmark" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="Benchmark" strokeDasharray="4 4" />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {analytics.attribution && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Brinson attribution</CardTitle>
                <CardDescription>
                  Allocation, selection and interaction effects against an equal-weight proxy of the same assets.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b uppercase tracking-wider text-muted-foreground">
                      {["Asset", "Portfolio wt", "Benchmark wt", "Allocation", "Selection", "Interaction", "Total"].map((h) => (
                        <th key={h} className="py-2 pr-4 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.attribution.rows.map((r) => (
                      <tr key={r.name} className="border-b last:border-0 font-mono">
                        <td className="py-2 pr-4 font-sans font-medium">{r.name}</td>
                        <td className="py-2 pr-4">{formatPercent(r.portfolioWeight)}</td>
                        <td className="py-2 pr-4">{formatPercent(r.benchmarkWeight)}</td>
                        <td className={cn("py-2 pr-4", r.allocation >= 0 ? "text-signal-positive" : "text-signal-negative")}>{formatPercent(r.allocation)}</td>
                        <td className={cn("py-2 pr-4", r.selection >= 0 ? "text-signal-positive" : "text-signal-negative")}>{formatPercent(r.selection)}</td>
                        <td className={cn("py-2 pr-4", r.interaction >= 0 ? "text-signal-positive" : "text-signal-negative")}>{formatPercent(r.interaction)}</td>
                        <td className="py-2 pr-4 font-semibold">{formatPercent(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="font-mono font-semibold">
                      <td className="py-2 pr-4 font-sans">Total</td>
                      <td className="py-2 pr-4" />
                      <td className="py-2 pr-4" />
                      <td className="py-2 pr-4">{formatPercent(analytics.attribution.totals.allocation)}</td>
                      <td className="py-2 pr-4">{formatPercent(analytics.attribution.totals.selection)}</td>
                      <td className="py-2 pr-4">{formatPercent(analytics.attribution.totals.interaction)}</td>
                      <td className="py-2 pr-4">{formatPercent(analytics.attribution.totals.activeReturn)}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="allocation" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Position weights</CardTitle></CardHeader>
              <CardContent>
                {analytics.allocation.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No positions yet.</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={analytics.allocation} dataKey="weight" nameKey="ticker" innerRadius={55} outerRadius={95} paddingAngle={2}>
                          {analytics.allocation.map((a, i) => (
                            <Cell key={a.ticker} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={chartTooltip} formatter={(v: number) => formatPercent(v)} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Sector exposure</CardTitle></CardHeader>
              <CardContent>
                {analytics.sectorAllocation.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No sectors classified.</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.sectorAllocation} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatPercent(v)} />
                        <YAxis type="category" dataKey="sector" width={110} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={chartTooltip} formatter={(v: number) => formatPercent(v)} />
                        <Bar dataKey="weight" fill="hsl(var(--signal-positive))" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="risk" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Risk contribution</CardTitle>
                <CardDescription>Share of total portfolio variance contributed by each position.</CardDescription>
              </CardHeader>
              <CardContent>
                {analytics.riskContributions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Not enough history for a covariance estimate.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.riskContributions}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                        <Tooltip contentStyle={chartTooltip} formatter={(v: number) => `${Number(v).toFixed(1)}%`} />
                        <Bar dataKey="percentOfRisk" fill="hsl(var(--signal-amber))" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drawdown</CardTitle>
                <CardDescription>Underwater curve from the running peak.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.equityCurve}>
                      <defs>
                        <linearGradient id="dd" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--signal-negative))" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(var(--signal-negative))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatPercent(v)} />
                      <Tooltip contentStyle={chartTooltip} formatter={(v: number) => formatPercent(v)} />
                      <Area type="monotone" dataKey="drawdown" stroke="hsl(var(--signal-negative))" fill="url(#dd)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correlation matrix</CardTitle>
              <CardDescription>Pearson correlation of the position return series.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {analytics.correlation.names.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No return series available.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-4 text-left font-medium" />
                      {analytics.correlation.names.map((n) => (
                        <th key={n} className="py-2 pr-4 text-right font-medium">{n}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.correlation.names.map((row, i) => (
                      <tr key={row} className="border-b last:border-0 font-mono">
                        <td className="py-2 pr-4 font-sans font-medium">{row}</td>
                        {analytics.correlation.names.map((_, j) => {
                          const v = analytics.correlation.matrix[i]?.[j] ?? null;
                          return (
                            <td key={j} className="py-2 pr-4 text-right">
                              {v === null ? "—" : v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="positions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Positions</CardTitle>
              <CardDescription>Edit share counts to reprice the portfolio against the latest close.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                      {["Ticker", "Name", "Sector", "Shares", "Last price", "Market value", "Weight", ""].map((h) => (
                        <th key={h} className="py-2 pr-4 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.ticker} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono font-semibold">{p.ticker}</td>
                        <td className="py-2 pr-4">{p.name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{p.sector ?? "—"}</td>
                        <td className="py-2 pr-4">
                          <Input
                            className="h-8 w-24"
                            value={shares[p.ticker] ?? String(p.shares)}
                            onChange={(e) => setShares((s) => ({ ...s, [p.ticker]: e.target.value }))}
                            inputMode="decimal"
                          />
                        </td>
                        <td className="py-2 pr-4 font-mono">{p.lastPrice !== null ? formatCurrency(p.lastPrice) : "—"}</td>
                        <td className="py-2 pr-4 font-mono">{formatCurrency(p.marketValue)}</td>
                        <td className="py-2 pr-4 font-mono">{formatPercent(p.weight)}</td>
                        <td className="py-2 pr-4">
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => savePosition(p.ticker)} disabled={saving === p.ticker}>
                              {saving === p.ticker ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => removePosition(p.ticker)} disabled={saving === p.ticker}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {positions.length === 0 && (
                      <tr><td colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No positions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="optimizer" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Constrained optimisation</CardTitle>
              <CardDescription>
                Rebuilds the target weights from the portfolio&apos;s own return series (Ledoit–Wolf
                shrinkage covariance) and shows the efficient frontier.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="max-sharpe">Max Sharpe</SelectItem>
                      <SelectItem value="min-variance">Minimum variance</SelectItem>
                      <SelectItem value="risk-parity">Risk parity</SelectItem>
                      <SelectItem value="inverse-vol">Inverse volatility</SelectItem>
                      <SelectItem value="equal-weight">Equal weight</SelectItem>
                      <SelectItem value="black-litterman">Black–Litterman</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Label className="text-xs">Max single-name weight</Label>
                    <span className="font-mono text-xs">{Math.round(maxWeight * 100)}%</span>
                  </div>
                  <Slider value={[maxWeight]} min={5} max={100} step={5} onValueChange={([v]) => setMaxWeight(v / 100)} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Label className="text-xs">Risk-free rate</Label>
                    <span className="font-mono text-xs">{(riskFree * 100).toFixed(1)}%</span>
                  </div>
                  <Slider value={[riskFree * 100]} min={0} max={10} step={0.25} onValueChange={([v]) => setRiskFree(v / 100)} />
                </div>
              </div>
              <Button onClick={runOptimizer} disabled={optimizing || positions.length < 2}>
                {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Optimise
              </Button>
              {positions.length < 2 && (
                <p className="text-xs text-muted-foreground">
                  Add at least two positions with price history to run the optimiser.
                </p>
              )}
            </CardContent>
          </Card>

          {optimization && (
            <>
              <div className="grid gap-4 sm:grid-cols-4">
                <Metric label="Expected return" value={formatPercent(optimization.expectedReturn)} hint="annualised" />
                <Metric label="Volatility" value={formatPercent(optimization.volatility)} hint="annualised" />
                <Metric label="Sharpe" value={optimization.sharpe.toFixed(2)} hint={`${optimization.frequency} series`} />
                <Metric label="Observations" value={String(optimization.observations)} hint={`${optimization.assets.length} assets`} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Target vs current weights</CardTitle>
                  <CardDescription>
                    {optimization.diagnostics.converged ? "Solver converged." : "Solver stopped early."}
                    {optimization.diagnostics.shrinkageApplied && " Covariance was shrunk towards the identity (Ledoit–Wolf)."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b uppercase tracking-wider text-muted-foreground">
                        {["Asset", "Sector", "Current", "Target", "Change", "Exp. return", "Volatility"].map((h) => (
                          <th key={h} className="py-2 pr-4 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {optimization.assets.map((a) => {
                        const change = a.targetWeight - a.currentWeight;
                        return (
                          <tr key={a.symbol} className="border-b last:border-0 font-mono">
                            <td className="py-2 pr-4 font-sans font-semibold">{a.symbol}</td>
                            <td className="py-2 pr-4 font-sans text-muted-foreground">{a.sector}</td>
                            <td className="py-2 pr-4">{formatPercent(a.currentWeight)}</td>
                            <td className="py-2 pr-4 font-semibold">{formatPercent(a.targetWeight)}</td>
                            <td className={cn("py-2 pr-4", change > 0 ? "text-signal-positive" : change < 0 ? "text-signal-negative" : "")}>
                              {change > 0 ? "+" : ""}{formatPercent(change)}
                            </td>
                            <td className="py-2 pr-4">{formatPercent(a.expectedReturn)}</td>
                            <td className="py-2 pr-4">{formatPercent(a.volatility)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {optimization.frontier.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Efficient frontier</CardTitle>
                    <CardDescription>Expected return against annualised volatility.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis type="number" dataKey="volatility" name="Volatility" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatPercent(v)} />
                          <YAxis type="number" dataKey="expectedReturn" name="Return" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatPercent(v)} />
                          <ZAxis range={[60, 60]} />
                          <Tooltip
                            contentStyle={chartTooltip}
                            cursor={{ strokeDasharray: "3 3" }}
                            formatter={(v: number) => formatPercent(v)}
                          />
                          <Scatter data={optimization.frontier} fill="hsl(var(--signal-positive))" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

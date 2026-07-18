"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { formatPercent } from "@/lib/utils";

interface Strategy { slug: string; name: string; category: string }

export function BenchmarkWorkbench({ strategies }: { strategies: Strategy[] }) {
  const { toast } = useToast();
  const [slug, setSlug] = React.useState(strategies[0]?.slug ?? "");
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<any>(null);

  async function run() {
    setLoading(true);
    const res = await fetch("/api/benchmarking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategySlug: slug }) });
    const d = await res.json(); setLoading(false);
    if (!res.ok) { toast({ title: "Error", description: d.error, variant: "destructive" as any }); return; }
    setData(d);
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="w-64"><Label className="text-xs mb-1 block">Strategy</Label>
          <Select value={slug} onValueChange={setSlug}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{strategies.map(s => <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-end"><Button onClick={run} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Benchmark</Button></div>
      </div>

      {!data && <Card><CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">Run benchmarking to compare your companies by sector.</CardContent></Card>}

      {data && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Median score by sector</CardTitle></CardHeader>
            <CardContent><div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.sectorBenchmarks} margin={{ left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="sector" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                  <Bar dataKey="medianScore" radius={[3, 3, 0, 0]} name="Median Score">
                    {data.sectorBenchmarks.map((s: any, i: number) => (
                      <Cell key={i} fill={s.medianScore >= 70 ? "hsl(var(--signal-positive))" : s.medianScore >= 45 ? "hsl(var(--signal-amber))" : "hsl(var(--signal-negative))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div></CardContent>
          </Card>

          {data.sectorBenchmarks.map((sector: any) => (
            <Card key={sector.sector}>
              <CardHeader>
                <CardTitle className="text-base">{sector.sector}</CardTitle>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Median score: <span className="font-mono font-semibold text-foreground">{sector.medianScore ?? "—"}</span></span>
                  <span>Median ROA: <span className="font-mono">{formatPercent(sector.medianRoa)}</span></span>
                  <span>Median ROE: <span className="font-mono">{formatPercent(sector.medianRoe)}</span></span>
                  <span>Median Net Margin: <span className="font-mono">{formatPercent(sector.medianNetMargin)}</span></span>
                </div>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-muted-foreground">
                    {["Ticker","Score","vs Median","Verdict","ROA","ROE","Net Margin"].map(h => <th key={h} className="py-1.5 pr-4 text-left font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>{sector.companies.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0)).map((c: any) => {
                    const rel = c.score !== null && sector.medianScore !== null ? c.score - sector.medianScore : null;
                    return (
                      <tr key={c.ticker} className="border-b last:border-0 font-mono">
                        <td className="py-2 pr-4 font-sans font-medium">{c.ticker}</td>
                        <td className="py-2 pr-4">{c.score ?? "—"}</td>
                        <td className="py-2 pr-4">{rel !== null ? <span className={rel > 0 ? "text-signal-positive" : "text-signal-negative"}>{rel > 0 ? "+" : ""}{rel.toFixed(0)}</span> : "—"}</td>
                        <td className="py-2 pr-4">{c.verdict ? <Badge variant={c.verdictColor as any} className="text-[10px]">{c.verdict}</Badge> : "—"}</td>
                        <td className="py-2 pr-4">{formatPercent(c.roa)}</td>
                        <td className="py-2 pr-4">{formatPercent(c.roe)}</td>
                        <td className="py-2 pr-4">{formatPercent(c.netMargin)}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

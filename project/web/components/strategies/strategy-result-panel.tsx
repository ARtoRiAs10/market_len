"use client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { formatPercent } from "@/lib/utils";

interface Criterion {
  key: string;
  label: string;
  category: string;
  pass: boolean | null;
  value: number | null;
  threshold?: string;
  weight: number;
  explanation: string;
}

interface SeriesPoint {
  label: string;
  [key: string]: string | number | null;
}

interface Result {
  score: number;
  maxScore: number;
  rawScore: number;
  verdict: string;
  verdictColor: "positive" | "negative" | "amber";
  summary: string;
  criteria: Criterion[];
  series: SeriesPoint[];
  generatedAt: string;
}

export function StrategyResultPanel({ result, ticker }: { result: Result; ticker: string }) {
  const scoredCriteria = result.criteria.filter((c) => c.weight > 0);
  const dupontCriteria = result.criteria.filter((c) => c.weight === 0);

  const categories = Array.from(new Set(scoredCriteria.map((c) => c.category)));

  return (
    <div className="space-y-6">
      {/* Score strip — signature element */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs text-muted-foreground">{ticker}</p>
              <p className="font-display text-xl">Score: {result.score} / {result.maxScore}</p>
            </div>
            <Badge variant={result.verdictColor as any} className="text-sm">{result.verdict}</Badge>
          </div>
          <div className="mt-4 flex gap-1">
            {scoredCriteria.map((c) => (
              <div
                key={c.key}
                title={`${c.label}: ${c.pass === null ? "N/A" : c.pass ? "Pass" : "Fail"}`}
                className={`h-8 flex-1 rounded-sm ${
                  c.pass === true
                    ? "bg-signal-positive/70"
                    : c.pass === false
                    ? "bg-signal-negative/50"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{result.summary}</p>
        </CardContent>
      </Card>

      {/* Criteria breakdown by category */}
      {categories.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-base">{category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {scoredCriteria
              .filter((c) => c.category === category)
              .map((c) => (
                <CriterionRow key={c.key} criterion={c} />
              ))}
          </CardContent>
        </Card>
      ))}

      {/* DuPont decomposition context */}
      {dupontCriteria.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">DuPont ROE Decomposition</CardTitle>
            <CardDescription>Context metrics — not scored, shown to explain the “why” behind profitability.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {dupontCriteria.map((c) => (
              <div key={c.key} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                <span className="text-muted-foreground">{c.label}</span>
                <span className="font-mono">{c.value !== null ? formatPercent(c.value) : "—"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ROA / ROE / Gross Margin trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                />
                <Line type="monotone" dataKey="roa" stroke="hsl(var(--signal-positive))" strokeWidth={2} dot={false} name="ROA" />
                <Line type="monotone" dataKey="roe" stroke="hsl(var(--signal-amber))" strokeWidth={2} dot={false} name="ROE" />
                <Line type="monotone" dataKey="grossMargin" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="Gross Margin" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CriterionRow({ criterion }: { criterion: Criterion }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2.5 text-sm last:border-0">
      <div className="flex gap-3">
        <span
          className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            criterion.pass === true
              ? "bg-signal-positive/20 text-signal-positive"
              : criterion.pass === false
              ? "bg-signal-negative/20 text-signal-negative"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {criterion.pass === true ? "✓" : criterion.pass === false ? "✕" : "?"}
        </span>
        <div>
          <p className="font-medium">{criterion.label}</p>
          <p className="text-xs text-muted-foreground">{criterion.explanation}</p>
          {criterion.threshold && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{criterion.threshold}</p>}
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs">
        {criterion.value !== null ? formatPercent(criterion.value) : "N/A"}
      </span>
    </div>
  );
}

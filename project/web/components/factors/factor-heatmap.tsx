"use client";
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FactorDefinition {
  key: string;
  name: string;
  description: string;
  higherIsBetter: boolean;
  paper: string;
}

export interface FactorExposure {
  key: string;
  name: string;
  raw: number | null;
  z: number | null;
  percentile: number | null;
  higherIsBetter: boolean;
  description: string;
  paper: string;
}

export interface FactorProfile {
  ticker: string;
  exposures: FactorExposure[];
  compositeScore: number | null;
  drivers: { key: string; name: string; percentile: number | null }[];
  detractors: { key: string; name: string; percentile: number | null }[];
}

/**
 * Factor heatmap.
 *
 * Each cell shows the percentile rank of the company inside the tracked
 * universe (0 = worst, 100 = best), sign-adjusted so that "higher is better"
 * always points up.
 */
export function FactorHeatmap({
  factors,
  profiles,
  universeSize,
}: {
  factors: FactorDefinition[];
  profiles: FactorProfile[];
  universeSize: number;
}) {
  const [sortKey, setSortKey] = React.useState<string>("composite");

  const sorted = React.useMemo(() => {
    const rows = [...profiles];
    if (sortKey === "composite") {
      rows.sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));
    } else {
      const def = factors.find((f) => f.key === sortKey);
      const pick = (p: FactorProfile) =>
        p.exposures.find((e) => e.key === sortKey)?.percentile ?? -1;
      rows.sort((a, b) => {
        const diff = pick(b) - pick(a);
        return def && !def.higherIsBetter ? -diff : diff;
      });
    }
    return rows;
  }, [profiles, sortKey, factors]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Factor exposures</CardTitle>
              <CardDescription>
                Percentile rank inside the tracked universe ({universeSize} companies). Click a column to sort.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 text-left font-medium">Ticker</th>
                <th className="py-2 pr-4 text-left font-medium">Composite</th>
                {factors.map((f) => (
                  <th key={f.key} className="py-2 pr-3 text-right font-medium">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setSortKey(f.key)}
                            className={cn(
                              "hover:text-foreground",
                              sortKey === f.key && "font-semibold text-foreground"
                            )}
                          >
                            {f.name.split(" (")[0]}
                            {f.higherIsBetter ? " ↑" : " ↓"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          <p className="font-medium">{f.name}</p>
                          <p className="mt-1">{f.description}</p>
                          <p className="mt-1 text-muted-foreground">{f.paper}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.ticker} className="border-b last:border-0 hover:bg-secondary/20">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/companies/${p.ticker}`} className="font-mono font-semibold hover:underline">
                      {p.ticker}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {p.compositeScore === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge
                        variant={p.compositeScore >= 60 ? "positive" : p.compositeScore <= 40 ? "negative" : "outline"}
                        className="font-mono text-[10px]"
                      >
                        {p.compositeScore}
                      </Badge>
                    )}
                  </td>
                  {factors.map((f) => {
                    const e = p.exposures.find((x) => x.key === f.key);
                    const pct = e?.percentile ?? null;
                    const good = pct === null ? null : f.higherIsBetter ? pct >= 50 : pct <= 50;
                    return (
                      <td key={f.key} className="py-2 pr-3 text-right">
                        {pct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              "inline-block rounded px-1.5 py-0.5 font-mono",
                              good === null
                                ? ""
                                : good
                                  ? "bg-signal-positive/15 text-signal-positive"
                                  : "bg-signal-negative/10 text-signal-negative"
                            )}
                          >
                            {Math.round(pct)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={factors.length + 2} className="py-6 text-center text-muted-foreground">
                    No company has enough history for a factor profile yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Tabs defaultValue="definitions">
        <TabsList>
          <TabsTrigger value="definitions">Factor definitions</TabsTrigger>
        </TabsList>
        <TabsContent value="definitions" className="mt-4">
          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              {factors.map((f) => (
                <div key={f.key}>
                  <p className="text-sm font-medium">
                    {f.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({f.higherIsBetter ? "higher is better" : "lower is better"})
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">{f.paper}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

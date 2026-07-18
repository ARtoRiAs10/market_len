"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { CalendarDays, ArrowUpRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface EarningsEvent {
  ticker: string; name: string; sector: string | null;
  latestQuarter: string; nextQuarter: string;
  estimatedDate: string; daysUntil: number; status: string;
}

const STATUS_CONFIG = {
  reported: { label: "Reported", variant: "outline" as const, color: "text-muted-foreground" },
  imminent: { label: "This week", variant: "negative" as const, color: "text-signal-negative" },
  upcoming: { label: "This month", variant: "amber" as const, color: "text-signal-amber" },
  future: { label: "Future", variant: "secondary" as const, color: "text-muted-foreground" },
};

export function EarningsCalendar() {
  const { toast } = useToast();
  const [events, setEvents] = React.useState<EarningsEvent[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/earnings-calendar")
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .catch(() => toast({ title: "Failed to load calendar", variant: "destructive" as any }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card><CardContent className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading earnings calendar...</CardContent></Card>;

  if (events.length === 0) return (
    <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
      <CalendarDays className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No companies in watchlist. Add companies to see their earnings calendar.</p>
      <Link href="/dashboard/companies"><Button size="sm">Add companies</Button></Link>
    </CardContent></Card>
  );

  const upcoming = events.filter(e => e.status !== "reported");
  const reported = events.filter(e => e.status === "reported");

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Reporting this week", count: events.filter(e => e.status === "imminent").length, color: "text-signal-negative" },
          { label: "Reporting this month", count: events.filter(e => e.status === "upcoming").length, color: "text-signal-amber" },
          { label: "Already reported", count: reported.length, color: "text-muted-foreground" },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 font-mono text-2xl font-semibold", s.color)}>{s.count}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Upcoming earnings</CardTitle></CardHeader>
        <CardContent>
          {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming earnings in the next period.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                {["Ticker","Company","Sector","Latest Filed","Next Quarter","Est. Date","Days","Status",""].map(h => (
                  <th key={h} className="py-2 pr-4 text-left font-medium">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {upcoming.map(e => {
                  const cfg = STATUS_CONFIG[e.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.future;
                  return (
                    <tr key={e.ticker} className="border-b last:border-0 hover:bg-secondary/30">
                      <td className="py-2.5 pr-4 font-mono font-semibold">{e.ticker}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground truncate max-w-[150px]">{e.name}</td>
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground">{e.sector ?? "—"}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{e.latestQuarter}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-signal-amber">{e.nextQuarter}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{e.estimatedDate}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs">
                        <span className={cfg.color}>{e.daysUntil > 0 ? `${e.daysUntil}d` : "—"}</span>
                      </td>
                      <td className="py-2.5 pr-4"><Badge variant={cfg.variant}>{cfg.label}</Badge></td>
                      <td className="py-2.5">
                        <Link href={`/dashboard/companies/${e.ticker}`} className="text-muted-foreground hover:text-foreground">
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {reported.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base text-muted-foreground">Recently reported — refresh ETL to update</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {reported.map(e => (
                <Link key={e.ticker} href={`/dashboard/etl?ticker=${e.ticker}`}>
                  <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-secondary">
                    <RefreshCw className="h-3 w-3" />{e.ticker}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

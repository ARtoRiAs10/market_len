"use client";
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Loader2, Plus, Trash2, Wallet } from "lucide-react";

export interface PortfolioSummary {
  id: string;
  name: string;
  description: string | null;
  baseCurrency: string;
  benchmarkTicker: string | null;
  cashBalance: number;
  positions: number;
  createdAt: string;
}

export interface CompanyOption {
  ticker: string;
  name: string;
}

/**
 * Portfolio list + creation form.
 *
 * Everything is written through the `/api/portfolio` routes so the audit log
 * stays complete (the service layer is the single source of truth for the
 * numbers shown on the detail page).
 */
export function PortfolioManager({
  initialPortfolios,
  companies,
}: {
  initialPortfolios: PortfolioSummary[];
  companies: CompanyOption[];
}) {
  const { toast } = useToast();
  const [portfolios, setPortfolios] = React.useState(initialPortfolios);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [benchmark, setBenchmark] = React.useState("");
  const [cash, setCash] = React.useState("0");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  async function refresh() {
    const res = await fetch("/api/portfolio");
    if (!res.ok) return;
    const data = await res.json();
    setPortfolios(data.portfolios ?? []);
  }

  async function create() {
    if (!name.trim()) {
      toast({ title: "Name required", description: "Give the portfolio a name first.", variant: "destructive" as any });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        benchmarkTicker: benchmark.trim() || undefined,
        cashBalance: Number(cash) || 0,
        tickers: selected,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Could not create portfolio", description: data.error, variant: "destructive" as any });
      return;
    }
    toast({ title: "Portfolio created", description: `${name.trim()} is ready.` });
    setName(""); setDescription(""); setBenchmark(""); setCash("0"); setSelected([]);
    setOpen(false);
    await refresh();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: "Could not delete portfolio", description: data.error, variant: "destructive" as any });
      return;
    }
    toast({ title: "Portfolio deleted" });
    await refresh();
  }

  function toggleTicker(ticker: string) {
    setSelected((prev) => (prev.includes(ticker) ? prev.filter((t) => t !== ticker) : [...prev, ticker]));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Portfolios</h1>
          <p className="text-sm text-muted-foreground">
            Group holdings, track risk contribution and compare against a benchmark.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New portfolio</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New portfolio</DialogTitle>
              <DialogDescription>
                Seed the portfolio with tracked tickers. Shares can be edited on the detail page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Core Growth" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Long-term holdings" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Benchmark ticker</Label>
                  <Input value={benchmark} onChange={(e) => setBenchmark(e.target.value.toUpperCase())} placeholder="SPY" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cash balance</Label>
                  <Input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" placeholder="0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Positions</Label>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                  {companies.length === 0 && (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      No companies tracked yet — add some on the Companies page first.
                    </p>
                  )}
                  {companies.map((c) => (
                    <label key={c.ticker} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-secondary/60">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.ticker)}
                        onChange={() => toggleTicker(c.ticker)}
                        className="h-3.5 w-3.5 accent-[hsl(var(--signal-positive))]"
                      />
                      <span className="font-mono text-xs font-semibold">{c.ticker}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {portfolios.length === 0 ? (
        <Card>
          <CardContent className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-6 w-6" />
            No portfolios yet. Create one to start tracking allocation and risk.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {portfolios.map((p) => (
            <Card key={p.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      <Link href={`/dashboard/portfolios/${p.id}`} className="hover:underline">{p.name}</Link>
                    </CardTitle>
                    <CardDescription className="mt-1 line-clamp-2 text-xs">
                      {p.description ?? "No description"}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete portfolio"
                    onClick={() => remove(p.id)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cash</span>
                  <span className="font-mono">{formatCurrency(p.cashBalance, { currency: p.baseCurrency })}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Positions</span>
                  <span className="font-mono">{p.positions}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Benchmark</span>
                  {p.benchmarkTicker
                    ? <Badge variant="outline" className="font-mono text-[10px]">{p.benchmarkTicker}</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

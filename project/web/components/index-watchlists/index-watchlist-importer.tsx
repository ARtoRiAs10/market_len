"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface IndexList { id: string; name: string; description: string | null; region: string | null; tickers: string[] }

export function IndexWatchlistImporter({ lists, watchedTickers }: { lists: IndexList[]; watchedTickers: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [importing, setImporting] = useState<string | null>(null);
  const watched = new Set(watchedTickers);

  async function importList(list: IndexList) {
    setImporting(list.id);
    try {
      const res = await fetch("/api/watchlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: list.tickers, listName: list.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: `Import failed`, description: data.error ?? "Please try again.", variant: "destructive" as any });
        return;
      }
      toast({
        title: `Imported ${data.added} companies`,
        description: `${data.skipped} already watched${data.failed ? `, ${data.failed} failed` : ""}. From ${list.name}`,
      });
      router.refresh();
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {lists.map(list => {
        const alreadyWatched = list.tickers.filter(t => watched.has(t)).length;
        const toImport = list.tickers.length - alreadyWatched;
        return (
          <Card key={list.id} className={cn("transition-colors", alreadyWatched === list.tickers.length && "border-signal-positive/30")}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{list.name}</CardTitle>
                  {list.description && <CardDescription className="mt-0.5">{list.description}</CardDescription>}
                </div>
                {list.region && <Badge variant="outline" className="text-[10px] shrink-0">{list.region}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-1">
                {list.tickers.map(t => (
                  <Badge key={t} variant={watched.has(t) ? "positive" : "secondary"} className="text-[10px] font-mono">
                    {watched.has(t) && <Check className="h-2.5 w-2.5 mr-0.5" />}{t}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{alreadyWatched}/{list.tickers.length} already in watchlist</p>
                <Button size="sm" onClick={() => importList(list)} disabled={importing === list.id || toImport === 0}>
                  {importing === list.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {toImport === 0 ? "All imported" : `Import ${toImport}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, ClipboardCheck, LayoutDashboard, History, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ResultItem = { type: string; label: string; sub: string; href: string };
type Results = { companies: ResultItem[]; strategies: ResultItem[]; runs: ResultItem[]; pages: ResultItem[] };

const TYPE_ICONS: Record<string, React.ReactNode> = {
  company:  <Building2 className="h-3.5 w-3.5" />,
  strategy: <ClipboardCheck className="h-3.5 w-3.5" />,
  run:      <History className="h-3.5 w-3.5" />,
  page:     <LayoutDashboard className="h-3.5 w-3.5" />,
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Results | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K shortcut
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  React.useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(""); setResults(null); setSelected(0); }
  }, [open]);

  // Debounced search
  React.useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/search?q=" + encodeURIComponent(query));
        const data = await res.json();
        setResults(data.results);
        setSelected(0);
      } finally { setLoading(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const flat: ResultItem[] = results ? [...results.companies, ...results.strategies, ...results.runs, ...results.pages] : [];

  function navigate(href: string) { router.push(href); setOpen(false); }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && flat[selected]) navigate(flat[selected].href);
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-2 hidden rounded bg-background px-1.5 py-0.5 font-mono text-[10px] border sm:inline">⌘K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden gap-0">
          <div className="flex items-center border-b px-4">
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-3" /> : <Search className="h-4 w-4 text-muted-foreground mr-3" />}
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Search companies, strategies, pages…"
              className="border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 py-4 h-auto"
            />
          </div>

          {!results && !loading && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Type to search companies, strategies, pages, and recent runs.
            </div>
          )}

          {results && flat.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No results for "{query}"</div>
          )}

          {results && flat.length > 0 && (
            <div className="max-h-80 overflow-y-auto py-2">
              {(["companies", "strategies", "runs", "pages"] as const).map(group => {
                const items = results[group];
                if (!items.length) return null;
                const labels: Record<string, string> = { companies: "Companies", strategies: "Strategies", runs: "Recent Runs", pages: "Pages" };
                return (
                  <div key={group}>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{labels[group]}</p>
                    {items.map((item, i) => {
                      const globalIdx = flat.indexOf(item);
                      return (
                        <button key={i} onClick={() => navigate(item.href)}
                          className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors", globalIdx === selected ? "bg-secondary" : "hover:bg-secondary/60")}>
                          <span className="text-muted-foreground">{TYPE_ICONS[item.type]}</span>
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.sub && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{item.sub}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t px-4 py-2 flex gap-4 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span><kbd className="font-mono">esc</kbd> close</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

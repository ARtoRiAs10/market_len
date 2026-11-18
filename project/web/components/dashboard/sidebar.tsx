"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LineChart, LayoutDashboard, ClipboardCheck, Workflow,
  CreditCard, Settings, ChevronDown, ChevronsLeft, ChevronsRight,
  Star, Building2, ScanSearch, TrendingUp, BarChart3, CalendarDays,
  Key, Bell, Users, Shield, FileText, List, Wallet, BookOpen, Grid3x3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDashboardShell } from "@/components/dashboard/shell-context";

interface StrategyNavItem { slug: string; name: string; category: string; icon: string | null }
interface WatchlistNavItem { ticker: string; name: string }

export function DashboardSidebar({ strategies, watchlist }: { strategies: StrategyNavItem[]; watchlist: WatchlistNavItem[] }) {
  const pathname = usePathname();
  const { mobileOpen, setMobileOpen } = useDashboardShell();
  const [collapsed, setCollapsed] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({ analytics: true, strategies: true, watchlist: true, account: false });

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const grouped = React.useMemo(() => {
    const map = new Map<string, StrategyNavItem[]>();
    for (const s of strategies) { if (!map.has(s.category)) map.set(s.category, []); map.get(s.category)!.push(s); }
    return Array.from(map.entries());
  }, [strategies]);

  return (
    <>
      {/* Mobile drawer backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-[260px] flex-col border-r bg-background transition-[width,transform] duration-200 md:sticky md:top-0 md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-[60px]" : "md:w-[260px]"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center border-b px-3">
          {!collapsed && (
            <Link href="/dashboard" className="flex flex-1 items-center gap-2">
              <LineChart className="h-5 w-5 shrink-0 text-signal-positive" />
              <span className="font-display text-base tracking-tight">MarketLens</span>
            </Link>
          )}
          {collapsed && <LineChart className="mx-auto h-5 w-5 text-signal-positive" />}
          <Button
            variant="ghost" size="icon"
            className={cn("h-7 w-7 shrink-0 md:inline-flex", collapsed && "md:absolute md:-right-3.5 md:top-5 md:z-10 md:rounded-full md:border md:bg-background md:shadow-sm")}
            onClick={() => {
              if (mobileOpen) setMobileOpen(false);
              else setCollapsed(c => !c);
            }}
            aria-label={mobileOpen ? "Close navigation" : collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {mobileOpen ? <ChevronsLeft className="h-3.5 w-3.5" /> : collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
          </Button>
        </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-3 space-y-0.5">
        {/* Core nav */}
        <N href="/dashboard" icon={<LayoutDashboard />} label="Overview" c={collapsed} active={pathname === "/dashboard"} />
        <N href="/dashboard/companies" icon={<Building2 />} label="Companies" c={collapsed} active={pathname.startsWith("/dashboard/companies")} />
        <N href="/dashboard/etl" icon={<Workflow />} label="ETL Pipeline" c={collapsed} active={pathname.startsWith("/dashboard/etl")} />
        <N href="/dashboard/earnings-calendar" icon={<CalendarDays />} label="Earnings Calendar" c={collapsed} active={pathname.startsWith("/dashboard/earnings-calendar")} />
        <N href="/dashboard/index-watchlists" icon={<List />} label="Index Watchlists" c={collapsed} active={pathname.startsWith("/dashboard/index-watchlists")} />

        {/* Analytics group */}
        <Group label="Analytics" icon={<BarChart3 />} open={open.analytics} onToggle={() => toggle("analytics")} collapsed={collapsed} />
        {open.analytics && !collapsed && (
          <div className="pl-2 space-y-0.5">
            <N href="/dashboard/screener" icon={<ScanSearch />} label="Screener" c={false} active={pathname === "/dashboard/screener"} indent />
            <N href="/dashboard/backtesting" icon={<TrendingUp />} label="Backtesting" c={false} active={pathname === "/dashboard/backtesting"} indent />
            <N href="/dashboard/benchmarking" icon={<BarChart3 />} label="Benchmarking" c={false} active={pathname === "/dashboard/benchmarking"} indent />
            <N href="/dashboard/factors" icon={<Grid3x3 />} label="Factor Exposure" c={false} active={pathname === "/dashboard/factors"} indent />
            <N href="/dashboard/portfolios" icon={<Wallet />} label="Portfolios" c={false} active={pathname.startsWith("/dashboard/portfolios")} indent />
            <N href="/dashboard/research" icon={<BookOpen />} label="Research Library" c={false} active={pathname === "/dashboard/research"} indent />
          </div>
        )}

        {/* Strategies group */}
        <Group label="Strategies" icon={<ClipboardCheck />} open={open.strategies} onToggle={() => toggle("strategies")} collapsed={collapsed} />
        {open.strategies && !collapsed && (
          <div className="pl-2 space-y-3">
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <p className="px-2 pb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">{cat}</p>
                <div className="space-y-0.5">
                  {items.map(s => (
                    <N key={s.slug} href={`/dashboard/strategies/${s.slug}`} icon={<ClipboardCheck />} label={s.name.length > 26 ? s.name.slice(0, 24) + "…" : s.name} c={false} active={pathname === `/dashboard/strategies/${s.slug}`} indent />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Watchlist group */}
        <Group label="Watchlist" icon={<Star />} open={open.watchlist} onToggle={() => toggle("watchlist")} collapsed={collapsed} />
        {open.watchlist && !collapsed && (
          <div className="space-y-0.5">
            {watchlist.length === 0 && <p className="px-3 py-1.5 text-xs text-muted-foreground">None yet.</p>}
            {watchlist.slice(0, 15).map(w => (
              <Link key={w.ticker} href={`/dashboard/companies/${w.ticker}`}
                className={cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors", pathname === `/dashboard/companies/${w.ticker}` ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}>
                <span className="font-mono text-xs font-semibold">{w.ticker}</span>
                <span className="truncate text-xs">{w.name}</span>
              </Link>
            ))}
            {watchlist.length > 15 && <p className="px-3 py-1 text-xs text-muted-foreground">+{watchlist.length - 15} more</p>}
          </div>
        )}

        {/* Account group */}
        <Group label="Account" icon={<Shield />} open={open.account} onToggle={() => toggle("account")} collapsed={collapsed} />
        {open.account && !collapsed && (
          <div className="pl-2 space-y-0.5">
            <N href="/dashboard/alerts" icon={<Bell />} label="Score Alerts" c={false} active={pathname === "/dashboard/alerts"} indent />
            <N href="/dashboard/team" icon={<Users />} label="Team" c={false} active={pathname === "/dashboard/team"} indent />
            <N href="/dashboard/audit-log" icon={<FileText />} label="Audit Log" c={false} active={pathname === "/dashboard/audit-log"} indent />
            <N href="/dashboard/sessions" icon={<Shield />} label="Sessions" c={false} active={pathname === "/dashboard/sessions"} indent />
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="border-t p-2 space-y-0.5">
        <N href="/dashboard/api-keys" icon={<Key />} label="API Keys" c={collapsed} active={pathname === "/dashboard/api-keys"} />
        <N href="/dashboard/billing" icon={<CreditCard />} label="Billing" c={collapsed} active={pathname === "/dashboard/billing"} />
        <N href="/dashboard/settings" icon={<Settings />} label="Settings" c={collapsed} active={pathname === "/dashboard/settings"} />
      </div>
    </aside>
    </>
  );
}

function Group({ label, icon, open, onToggle, collapsed }: { label: string; icon: React.ReactNode; open: boolean; onToggle: () => void; collapsed: boolean }) {
  return (
    <button onClick={onToggle} className={cn("flex w-full items-center rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground mt-2", collapsed ? "justify-center" : "justify-between")}>
      {collapsed ? <span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : <span>{label}</span>}
      {!collapsed && <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />}
    </button>
  );
}

function N({ href, icon, label, c, active, indent }: { href: string; icon: React.ReactNode; label: string; c: boolean; active?: boolean; indent?: boolean }) {
  return (
    <Link href={href} title={c ? label : undefined}
      className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors", active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground", c && "justify-center px-0", indent && "pl-3 text-[13px]")}>
      <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {!c && <span className="truncate">{label}</span>}
    </Link>
  );
}

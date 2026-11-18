"use client";

import { createContext, useContext, useMemo, useState } from "react";

interface DashboardShellState {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const DashboardShellContext = createContext<DashboardShellState | null>(null);

export function DashboardShellProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const value = useMemo(() => ({ mobileOpen, setMobileOpen }), [mobileOpen]);
  return <DashboardShellContext.Provider value={value}>{children}</DashboardShellContext.Provider>;
}

export function useDashboardShell(): DashboardShellState {
  const ctx = useContext(DashboardShellContext);
  if (!ctx) throw new Error("useDashboardShell must be used inside <DashboardShellProvider>");
  return ctx;
}
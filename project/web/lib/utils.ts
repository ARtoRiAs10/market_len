import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  value: number | string | null | undefined,
  options?: { compact?: boolean; currency?: string }
): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: options?.currency ?? "USD",
    notation: options?.compact ? "compact" : "standard",
    maximumFractionDigits: options?.compact ? 1 : 2,
  }).format(num);
}

export function formatPercent(
  value: number | string | null | undefined,
  decimals = 1
): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "—";
  return `${(num * 100).toFixed(decimals)}%`;
}

export function formatNumber(
  value: number | string | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatQuarter(fiscalYear: number, fiscalQuarter: number): string {
  return `Q${fiscalQuarter} FY${fiscalYear}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Anything numeric-ish, including Prisma `Decimal` instances. */
export type NumericLike = number | string | { toNumber(): number } | null | undefined;

/** Normalise a numeric-ish value (including Prisma `Decimal`) to a number. */
export function toNumeric(value: NumericLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatCurrency(
  value: NumericLike,
  options?: { compact?: boolean; currency?: string }
): string {
  if (value === null || value === undefined) return "—";
  const num = toNumeric(value);
  if (num === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: options?.currency ?? "USD",
    notation: options?.compact ? "compact" : "standard",
    maximumFractionDigits: options?.compact ? 1 : 2,
  }).format(num);
}

export function formatPercent(
  value: NumericLike,
  decimals = 1
): string {
  if (value === null || value === undefined) return "—";
  const num = toNumeric(value);
  if (num === null) return "—";
  return `${(num * 100).toFixed(decimals)}%`;
}

export function formatNumber(
  value: NumericLike,
  decimals = 2
): string {
  if (value === null || value === undefined) return "—";
  const num = toNumeric(value);
  if (num === null) return "—";
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

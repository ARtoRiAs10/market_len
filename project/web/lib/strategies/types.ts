/**
 * Strategy Plugin Framework
 * =========================
 * Every analysis strategy (Piotroski F-Score, Altman Z-Score, DCF, Momentum,
 * Magic Formula, etc.) implements the `StrategyDefinition` interface below.
 *
 * To add a new strategy:
 *   1. Create `lib/strategies/<your-strategy>.ts` implementing StrategyDefinition
 *   2. Register it in `lib/strategies/registry.ts`
 *   3. (Optional) add a matching row in the `Strategy` Prisma table via the
 *      seed script, for marketing copy / methodology text shown on its page
 *   4. The dashboard, strategy detail page, parameter form, and run API route
 *      all work automatically — they read from the registry.
 */

import { FinancialQuarter } from "@prisma/client";

/** A single configurable input exposed to the user on the strategy page. */
export interface StrategyParameter {
  key: string;
  label: string;
  description?: string;
  type: "number" | "slider" | "select" | "boolean";
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  unit?: string; // e.g. "%", "x", "quarters"
}

/** One pass/fail (or scored) criterion evaluated as part of the strategy. */
export interface StrategyCriterion {
  key: string;
  label: string;
  category: string; // groups criteria in the UI, e.g. "Profitability"
  pass: boolean | null; // null = insufficient data
  value: number | null;
  threshold?: string; // human-readable rule, e.g. "> 0"
  weight: number;
  explanation: string;
}

/** A single point in a time series the strategy wants to chart. */
export interface StrategySeriesPoint {
  label: string; // e.g. "Q1 FY2023"
  [metricKey: string]: string | number | null;
}

export interface StrategyResult {
  score: number; // normalized 0-100
  maxScore: number;
  rawScore: number;
  verdict: "Strong" | "Moderate" | "Weak" | "Insufficient Data";
  verdictColor: "positive" | "negative" | "amber";
  summary: string;
  criteria: StrategyCriterion[];
  series: StrategySeriesPoint[];
  generatedAt: string;
}

export interface StrategyDefinition {
  slug: string;
  name: string;
  shortDescription: string;
  category: string;
  icon: string; // lucide-react icon name
  parameters: StrategyParameter[];
  /** Minimum number of quarterly records required to run. */
  minQuartersRequired: number;
  /**
   * Pure function: given financial quarters (oldest -> newest) and
   * user-chosen parameters, compute the strategy result.
   */
  evaluate(
    quarters: FinancialQuarter[],
    params: Record<string, number | string | boolean>
  ): StrategyResult;
}

export function resolveParam(
  params: Record<string, number | string | boolean>,
  def: StrategyParameter
): number | string | boolean {
  return params[def.key] ?? def.defaultValue;
}

export function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "object" && value !== null && "toNumber" in (value as any)
    ? (value as any).toNumber()
    : Number(value);
  return Number.isFinite(n) ? n : null;
}

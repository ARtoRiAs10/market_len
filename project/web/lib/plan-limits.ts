import { PlanTier } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface PlanLimitConfig {
  label: string;
  priceMonthly: number;
  priceYearly: number;
  maxWatchlistItems: number;
  maxStrategyRunsDay: number;
  maxEtlJobsDay: number;
  maxCompaniesTracked: number;
  historicalQuarters: number;
  apiAccess: boolean;
  features: string[];
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimitConfig> = {
  FREE: {
    label: "Free", priceMonthly: 0, priceYearly: 0,
    maxWatchlistItems: 5, maxStrategyRunsDay: 3, maxEtlJobsDay: 1,
    maxCompaniesTracked: 10, historicalQuarters: 4, apiAccess: false,
    features: ["5 companies on watchlist","3 strategy runs / day","1 ETL job / day","Last 4 quarters of data","Piotroski F-Score strategy"],
  },
  PRO: {
    label: "Pro", priceMonthly: 49, priceYearly: 470,
    maxWatchlistItems: 100, maxStrategyRunsDay: 100, maxEtlJobsDay: 25,
    maxCompaniesTracked: 500, historicalQuarters: 40, apiAccess: true,
    features: ["100 companies on watchlist","100 strategy runs / day","25 ETL jobs / day","10 years of historical data","All strategies + custom parameters","CSV export","API access"],
  },
  ENTERPRISE: {
    label: "Enterprise", priceMonthly: 499, priceYearly: 4790,
    maxWatchlistItems: 10_000, maxStrategyRunsDay: 10_000, maxEtlJobsDay: 1_000,
    maxCompaniesTracked: 10_000, historicalQuarters: 200, apiAccess: true,
    features: ["Unlimited watchlist","Unlimited strategy runs","Bulk ETL pipelines","Full historical data","Custom strategy onboarding","SSO + audit log export","Dedicated support"],
  },
};

export async function getUserPlan(userId: string): Promise<PlanTier> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) return "FREE";
  if (sub.status === "ACTIVE" || sub.status === "TRIALING") return sub.plan;
  return "FREE";
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function checkStrategyRunLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].maxStrategyRunsDay;
  const count = await prisma.strategyRun.count({ where: { userId, startedAt: { gte: startOfToday() } } });
  return { allowed: count < limit, remaining: Math.max(0, limit - count) };
}

export async function checkEtlJobLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].maxEtlJobsDay;
  const count = await prisma.etlJob.count({ where: { userId, createdAt: { gte: startOfToday() } } });
  return { allowed: count < limit, remaining: Math.max(0, limit - count) };
}

export async function checkWatchlistLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].maxWatchlistItems;
  const count = await prisma.watchlistItem.count({ where: { userId } });
  return { allowed: count < limit, remaining: Math.max(0, limit - count) };
}

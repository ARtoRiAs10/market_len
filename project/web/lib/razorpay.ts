import Razorpay from "razorpay";
import { PlanTier, SubscriptionStatus } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var razorpayClient: Razorpay | undefined;
}

export type RazorpayPlanKey = "PRO_MONTHLY" | "PRO_YEARLY" | "ENTERPRISE_MONTHLY";

function createRazorpayClient(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Lazily-created Razorpay client. Importing this module must not require keys
 * (build steps and CLI scripts import it without secrets).
 */
export const razorpay: Razorpay = new Proxy({} as Razorpay, {
  get(_target, prop) {
    if (!globalThis.razorpayClient) globalThis.razorpayClient = createRazorpayClient();
    const value = Reflect.get(globalThis.razorpayClient, prop);
    return typeof value === "function" ? value.bind(globalThis.razorpayClient) : value;
  },
});

export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayKeyId(): string | undefined {
  return process.env.RAZORPAY_KEY_ID;
}

export function getRazorpayPlanId(key: RazorpayPlanKey): string | undefined {
  switch (key) {
    case "PRO_MONTHLY":
      return process.env.RAZORPAY_PLAN_PRO_MONTHLY;
    case "PRO_YEARLY":
      return process.env.RAZORPAY_PLAN_PRO_YEARLY;
    case "ENTERPRISE_MONTHLY":
      return process.env.RAZORPAY_PLAN_ENTERPRISE_MONTHLY;
  }
}

export function planTierFromRazorpayPlanId(planId?: string | null): PlanTier {
  if (!planId) return "FREE";
  if (planId === process.env.RAZORPAY_PLAN_PRO_MONTHLY || planId === process.env.RAZORPAY_PLAN_PRO_YEARLY) return "PRO";
  if (planId === process.env.RAZORPAY_PLAN_ENTERPRISE_MONTHLY) return "ENTERPRISE";
  return "FREE";
}

export function mapRazorpayStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
    case "authenticated":
      return "ACTIVE";
    case "pending":
      return "INCOMPLETE";
    case "halted":
      return "PAST_DUE";
    case "cancelled":
    case "expired":
    case "completed":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}
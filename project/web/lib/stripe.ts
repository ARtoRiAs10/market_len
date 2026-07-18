import Stripe from "stripe";

declare global {
  // eslint-disable-next-line no-var
  var stripeClient: Stripe | undefined;
}

function createStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key, {
    apiVersion: "2024-09-30.acacia",
    typescript: true,
    appInfo: { name: "MarketLens", version: "1.0.0" },
  });
}

export const stripe = globalThis.stripeClient ?? createStripeClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.stripeClient = stripe;
}

export const STRIPE_PRICE_IDS = {
  PRO_MONTHLY: process.env.STRIPE_PRICE_ID_PRO_MONTHLY!,
  PRO_YEARLY: process.env.STRIPE_PRICE_ID_PRO_YEARLY!,
  ENTERPRISE_MONTHLY: process.env.STRIPE_PRICE_ID_ENTERPRISE_MONTHLY,
} as const;

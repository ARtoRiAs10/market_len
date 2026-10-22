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
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: { name: "MarketLens", version: "1.0.0" },
  });
}

function resolveClient(): Stripe {
  if (globalThis.stripeClient) return globalThis.stripeClient;
  const client = createStripeClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.stripeClient = client;
  }
  return client;
}

/**
 * Lazily-created Stripe client.
 *
 * Importing this module must not require `STRIPE_SECRET_KEY` (build steps and
 * CLI scripts import it without secrets) — the key is only read when a Stripe
 * API call is actually made.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = resolveClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Stripe price IDs, read from the environment at call time. */
export const STRIPE_PRICE_IDS = {
  get PRO_MONTHLY() {
    return process.env.STRIPE_PRICE_ID_PRO_MONTHLY!;
  },
  get PRO_YEARLY() {
    return process.env.STRIPE_PRICE_ID_PRO_YEARLY!;
  },
  get ENTERPRISE_MONTHLY() {
    return process.env.STRIPE_PRICE_ID_ENTERPRISE_MONTHLY;
  },
} as const;

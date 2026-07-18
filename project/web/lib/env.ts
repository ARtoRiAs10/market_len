import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  // Auth
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
  STRIPE_PRICE_ID_PRO_MONTHLY: z.string().min(1),
  STRIPE_PRICE_ID_PRO_YEARLY: z.string().min(1),
  STRIPE_PRICE_ID_ENTERPRISE_MONTHLY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // ETL microservice
  ETL_SERVICE_URL: z.string().url().optional(),
  ETL_SERVICE_API_KEY: z.string().optional(),

  // Optional real market data provider
  MARKET_DATA_PROVIDER: z.enum(["MOCK", "ALPHA_VANTAGE", "FMP"]).default("MOCK"),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  FMP_API_KEY: z.string().optional(),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

// Lazily validated so local `next build` without all secrets (e.g. in CI lint
// steps) doesn't hard-crash; real runtime calls will throw clearly instead.
let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
    if (process.env.NODE_ENV === "production") {
      throw new Error("Invalid environment variables. Check server logs.");
    }
  }
  cached = (parsed.success ? parsed.data : process.env) as Env;
  return cached;
}

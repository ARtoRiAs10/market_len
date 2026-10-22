import { PrismaClient } from "@prisma/client";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

// Neon's serverless driver needs a WebSocket implementation outside the
// edge/browser runtime (e.g. when running in plain Node for scripts/tests).
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function resolveClient(): PrismaClient {
  if (globalThis.prisma) return globalThis.prisma;
  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.prisma = client;
  }
  return client;
}

/**
 * Prisma client proxy.
 *
 * The client is created lazily on first use so that importing a module (or
 * running `next build` without secrets) does not explode — the missing
 * `DATABASE_URL` surfaces as a clear error on the first query instead.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = resolveClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

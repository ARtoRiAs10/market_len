/**
 * MarketLens — Ensure the test admin login exists.
 *
 * Run: npm run db:admin
 *
 * Creates the admin user if missing and resets its password/role on every run,
 * so a fresh Vercel/Neon database always has a known login for testing.
 *
 * Configuration (optional — defaults shown):
 *   SEED_ADMIN_EMAIL=admin@marketlens.dev
 *   SEED_ADMIN_PASSWORD=Admin1234
 *   SEED_ADMIN_NAME=Demo Admin
 *   SEED_ADMIN_PLAN=PRO
 */
import { PlanTier } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";

// Neon's serverless driver needs a WebSocket implementation outside the
// edge/browser runtime (e.g. when running this script with tsx). lib/db.ts
// handles that and falls back to plain Prisma for local Postgres.

const email = (process.env.SEED_ADMIN_EMAIL || "admin@marketlens.dev").toLowerCase().trim();
const password = process.env.SEED_ADMIN_PASSWORD || "Admin1234";
const name = process.env.SEED_ADMIN_NAME || "Demo Admin";
const plan = (process.env.SEED_ADMIN_PLAN || "PRO") as PlanTier;

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      passwordHash,
      role: "ADMIN",
      emailVerified: new Date(),
    },
    // Reset the login on every run so the documented test password always works.
    update: { name, passwordHash, role: "ADMIN" },
  });

  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, plan, status: "ACTIVE" },
    update: { plan, status: "ACTIVE" },
  });

  console.log("\n✅ Admin login ready\n");
  console.log(`  userId:   ${user.id}`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  role:     ADMIN`);
  console.log(`  plan:     ${plan}\n`);
  if (password === "Admin1234") {
    console.log("  ⚠ Using the default test password. Set SEED_ADMIN_PASSWORD for a real deployment.\n");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
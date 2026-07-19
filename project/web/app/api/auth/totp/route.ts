/**
 * TOTP / 2FA endpoint
 * POST /api/auth/totp       - generate secret + QR code URI
 * PUT  /api/auth/totp       - verify code and activate 2FA
 * DELETE /api/auth/totp     - disable 2FA (requires current password re-auth)
 *
 * Uses otplib (install: npm i otplib qrcode @types/qrcode)
 * Falls back gracefully if library not installed.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { encryptTotpSecret, decryptTotpSecret } from "@/lib/totp";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () => crypto.randomBytes(4).toString("hex").toUpperCase());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`totp-setup:${session.user.id}`, { limit: 5, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  // Try to use otplib — if not installed, return setup instructions
  try {
    const { authenticator } = await import("otplib");
    const secret = authenticator.generateSecret();
    const otpUri = authenticator.keyuri(session.user.email ?? session.user.id, "MarketLens", secret);
    const encryptedSecret = encryptTotpSecret(secret);

    // Store unverified secret
    await prisma.totpSecret.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, secret: encryptedSecret, verified: false, backupCodes: [] },
      update: { secret: encryptedSecret, verified: false },
    });

    return NextResponse.json({ otpUri, secret, note: "Scan QR code, then PUT with a 6-digit code to verify and activate." });
  } catch {
    return NextResponse.json({
      error: "otplib not installed",
      setup: "Run: npm i otplib qrcode in the web/ directory to enable 2FA",
    }, { status: 501 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`totp-verify:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const { code } = z.object({ code: z.string().length(6) }).parse(body);

  const record = await prisma.totpSecret.findUnique({ where: { userId: session.user.id } });
  if (!record) return NextResponse.json({ error: "No pending TOTP setup. POST first." }, { status: 404 });

  try {
    const { authenticator } = await import("otplib");
    const secret = decryptTotpSecret(record.secret);
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 });

    const backupCodes = generateBackupCodes();
    const hashedCodes = backupCodes.map(c => crypto.createHash("sha256").update(c).digest("hex"));

    await prisma.totpSecret.update({
      where: { userId: session.user.id },
      data: { verified: true, backupCodes: hashedCodes },
    });
    await logAudit({ userId: session.user.id, action: "totp.enabled" });

    return NextResponse.json({ success: true, backupCodes, warning: "Save these backup codes. They are shown once." });
  } catch {
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}

const disableSchema = z.object({ password: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`totp-disable:${session.user.id}`, { limit: 5, windowMs: 60_000 });
  if (!limited.success) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  // Disabling 2FA is a sensitive, security-reducing action — require the
  // user to re-prove their password rather than trusting the session alone
  // (session cookies can be stolen via XSS/CSRF; a password re-check limits
  // the blast radius of a hijacked session).
  const body = await req.json().catch(() => ({}));
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Password required to disable 2FA." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 403 });
  }

  await prisma.totpSecret.deleteMany({ where: { userId: session.user.id } });
  await logAudit({ userId: session.user.id, action: "totp.disabled" });
  return NextResponse.json({ success: true, message: "2FA disabled." });
}

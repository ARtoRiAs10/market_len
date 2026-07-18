/**
 * TOTP / 2FA endpoint
 * POST /api/auth/totp       - generate secret + QR code URI
 * PUT  /api/auth/totp       - verify code and activate 2FA
 * DELETE /api/auth/totp     - disable 2FA
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

// Encryption helpers (AES-256-GCM with NEXTAUTH_SECRET as key)
function encrypt(text: string): string {
  const key = crypto.scryptSync(process.env.NEXTAUTH_SECRET ?? "dev-secret", "salt", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function decrypt(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(":");
  const key = crypto.scryptSync(process.env.NEXTAUTH_SECRET ?? "dev-secret", "salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex")).toString("utf8") + decipher.final("utf8");
}

function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () => crypto.randomBytes(4).toString("hex").toUpperCase());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Try to use otplib — if not installed, return setup instructions
  try {
    const { authenticator } = await import("otplib");
    const secret = authenticator.generateSecret();
    const otpUri = authenticator.keyuri(session.user.email ?? session.user.id, "MarketLens", secret);
    const encryptedSecret = encrypt(secret);

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
      otpUri: "otpauth://totp/MarketLens:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MarketLens",
    }, { status: 501 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { code } = z.object({ code: z.string().length(6) }).parse(body);

  const record = await prisma.totpSecret.findUnique({ where: { userId: session.user.id } });
  if (!record) return NextResponse.json({ error: "No pending TOTP setup. POST first." }, { status: 404 });

  try {
    const { authenticator } = await import("otplib");
    const secret = decrypt(record.secret);
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 });

    const backupCodes = generateBackupCodes();
    const hashedCodes = backupCodes.map(c => crypto.createHash("sha256").update(c).digest("hex"));

    await prisma.totpSecret.update({
      where: { userId: session.user.id },
      data: { verified: true, backupCodes: hashedCodes },
    });

    return NextResponse.json({ success: true, backupCodes, warning: "Save these backup codes. They are shown once." });
  } catch {
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.totpSecret.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ success: true, message: "2FA disabled." });
}

import crypto from "crypto";

/**
 * Shared TOTP helpers. Centralised so lib/auth.ts (login-time verification)
 * and app/api/auth/totp/route.ts (setup/enroll) can never drift out of sync.
 */

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Refuse to run with a guessable, hardcoded key. A missing
    // NEXTAUTH_SECRET in production would otherwise silently encrypt every
    // user's TOTP secret with the same well-known "dev-secret" key, letting
    // anyone who reads the DB decrypt 2FA secrets and bypass 2FA entirely.
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXTAUTH_SECRET must be set in production");
    }
    return crypto.scryptSync("dev-secret-do-not-use-in-prod", "salt", 32);
  }
  return crypto.scryptSync(secret, "salt", 32);
}

export function encryptTotpSecret(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

export function decryptTotpSecret(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(":");
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex")).toString("utf8") + decipher.final("utf8");
}

/**
 * Verify a 6-digit TOTP code OR a one-time backup code for the given user.
 * Consumes (deletes) the backup code on successful use so it can't be replayed.
 * Returns true if the code was valid.
 */
export async function verifyTotpForUser(
  prisma: any,
  userId: string,
  code: string
): Promise<boolean> {
  const record = await prisma.totpSecret.findUnique({ where: { userId } });
  if (!record || !record.verified) return true; // 2FA not enabled — nothing to check

  if (!code) return false;

  // Try backup codes first (hashed, single-use)
  const hashedInput = crypto.createHash("sha256").update(code.toUpperCase().trim()).digest("hex");
  const backupCodes: string[] = Array.isArray(record.backupCodes) ? record.backupCodes : [];
  if (backupCodes.includes(hashedInput)) {
    await prisma.totpSecret.update({
      where: { userId },
      data: { backupCodes: backupCodes.filter((c) => c !== hashedInput) },
    });
    return true;
  }

  try {
    const { authenticator } = await import("otplib");
    const secret = decryptTotpSecret(record.secret);
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export async function userHasTotpEnabled(prisma: any, userId: string): Promise<boolean> {
  const record = await prisma.totpSecret.findUnique({ where: { userId } });
  return !!record?.verified;
}

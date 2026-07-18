import { prisma } from "@/lib/db";

interface AuditEntry {
  userId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Fire-and-forget audit log write. Never throws — a logging failure should
 * not break the user-facing request.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        metadata: entry.metadata ? (entry.metadata as any) : undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err);
  }
}

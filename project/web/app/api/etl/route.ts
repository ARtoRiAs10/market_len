import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEtlJobLimit } from "@/lib/plan-limits";
import { triggerEtlJob } from "@/lib/etl-client";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import crypto from "crypto";
import { z } from "zod";

const startEtlSchema = z.object({
  ticker: z.string().min(1).max(10),
  quarters: z.number().min(4).max(40).default(12),
  sourceType: z.enum(["MOCK", "ALPHA_VANTAGE", "FMP"]).default("MOCK"),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await prisma.etlJob.findMany({
    where: { userId: session.user.id },
    include: { company: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimit(`etl-start:${session.user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests, slow down." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = startEtlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { ticker, quarters, sourceType } = parsed.data;
  const upperTicker = ticker.toUpperCase();

  const { allowed, remaining } = await checkEtlJobLimit(session.user.id);
  if (!allowed) {
    return NextResponse.json(
      { error: `Daily ETL job limit reached for your plan (${remaining} remaining). Upgrade for more.` },
      { status: 403 }
    );
  }

  const company = await prisma.company.findUnique({ where: { ticker: upperTicker } });

  const job = await prisma.etlJob.create({
    data: {
      userId: session.user.id,
      companyId: company?.id,
      sourceType,
      inputConfig: { ticker: upperTicker, quarters, sourceType } as any,
      stage: "EXTRACT",
      status: "QUEUED",
      stepLogs: [],
    },
  });

  const callbackSecret = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "dev-secret").update(job.id).digest("hex");

  try {
    await triggerEtlJob({
      jobId: job.id,
      ticker: upperTicker,
      quarters,
      sourceType,
      callbackUrl: `${process.env.NEXTAUTH_URL}/api/etl/${job.id}/callback`,
      callbackSecret,
    });
  } catch (err: any) {
    await prisma.etlJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: err?.message ?? "Failed to reach ETL service" },
    });
    return NextResponse.json(
      { error: err?.message ?? "Failed to start ETL job. Is the FastAPI service running?", jobId: job.id },
      { status: 502 }
    );
  }

  await prisma.etlJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
  await logAudit({ userId: session.user.id, action: "etl.start", metadata: { ticker: upperTicker, jobId: job.id } });

  return NextResponse.json({ job });
}

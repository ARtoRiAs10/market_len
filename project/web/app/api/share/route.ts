import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = z.object({ runId: z.string() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const run = await prisma.strategyRun.findFirst({
    where: { id: parsed.data.runId, userId: session.user.id },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const shared = await prisma.sharedRun.upsert({
    where: { runId: run.id },
    create: { runId: run.id, createdBy: session.user.id },
    update: {},
  });
  return NextResponse.json({ shareId: shared.id, url: `${process.env.NEXTAUTH_URL}/share/${shared.id}` });
}

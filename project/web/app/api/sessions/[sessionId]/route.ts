import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.session.deleteMany({ where: { id: params.sessionId, userId: session.user.id } });
  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: { teamId: string; memberId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const my = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: params.teamId, userId: session.user.id } } });
  if (!my || !["OWNER","ADMIN"].includes(my.role)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  await prisma.teamMember.delete({ where: { id: params.memberId } });
  return NextResponse.json({ success: true });
}

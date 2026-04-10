import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { BOT_USERNAME } from "@/lib/bot";

export async function GET(req: NextRequest) {
  const me = getCurrentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    where: {
      id: { not: me.userId },
      username: { not: BOT_USERNAME },
    },
    select: { id: true, username: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  return NextResponse.json({ users });
}

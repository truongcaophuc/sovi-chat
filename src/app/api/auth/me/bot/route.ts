import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// PATCH /api/auth/me/bot — update auto-reply (Parlant) settings for current user.
// Body: { enabled?: boolean, parlantUrl?: string, agentId?: string }
export async function PATCH(req: NextRequest) {
  const me = getCurrentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const data: Record<string, any> = {};
    if (typeof body.enabled === "boolean") data.botEnabled = body.enabled;
    if (typeof body.parlantUrl === "string") data.botParlantUrl = body.parlantUrl.trim() || null;
    if (typeof body.agentId === "string") data.botAgentId = body.agentId.trim() || null;

    const updated = await prisma.user.update({
      where: { id: me.userId },
      data,
      select: {
        id: true,
        username: true,
        displayName: true,
        botEnabled: true,
        botParlantUrl: true,
        botAgentId: true,
      },
    });
    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error("PATCH /api/auth/me/bot error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

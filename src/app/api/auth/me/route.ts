import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, AUTH_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const payload = getCurrentUser(req);
  if (!payload) return NextResponse.json({ user: null }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      botEnabled: true,
      botParlantUrl: true,
      botAgentId: true,
    },
  });
  // include token so client can pass it to socket.io handshake
  const token = req.cookies.get(AUTH_COOKIE)?.value ?? null;
  return NextResponse.json({ user, token });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
}

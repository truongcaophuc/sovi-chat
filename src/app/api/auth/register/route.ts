import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signToken, AUTH_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { username, displayName, password } = await req.json();
    if (!username || !password || !displayName) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "Password too short" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: "Username taken" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, displayName, passwordHash },
      select: { id: true, username: true, displayName: true },
    });

    const token = signToken({ userId: user.id, username: user.username });
    const res = NextResponse.json({ user, token });
    res.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

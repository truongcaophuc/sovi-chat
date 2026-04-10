import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signToken, AUTH_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, displayName, password } = body;
    const email = body.email?.trim().toLowerCase() || null;
    const phone = body.phone?.trim() || null;

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
    if (email) {
      const dup = await prisma.user.findUnique({ where: { email } });
      if (dup) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    if (phone) {
      const dup = await prisma.user.findUnique({ where: { phone } });
      if (dup) return NextResponse.json({ error: "Phone already in use" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, displayName, passwordHash, email, phone },
      select: { id: true, username: true, displayName: true, email: true, phone: true },
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

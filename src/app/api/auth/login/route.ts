import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/auth/session";
import { verifyUser } from "@/lib/auth/users";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const rl = rateLimit(`login:${ip}`, 8, 5 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: `Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.` }, { status: 429 });

  const { username, password } = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!username || !password) return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  const user = verifyUser(username, password);
  if (!user) {
    console.warn(`[auth] failed sign-in for "${username.slice(0, 40)}"`);
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  const token = await signSession({ u: user.username, n: user.name, r: user.role, t: user.title });
  console.info(`[auth] ${user.username} signed in`);
  const res = NextResponse.json({ ok: true, name: user.name, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return res;
}

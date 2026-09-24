import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Clears the auth cookie. The path/httpOnly settings must match how
// /api/auth/login sets the "token" cookie, otherwise the browser keeps it.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
  return res;
}
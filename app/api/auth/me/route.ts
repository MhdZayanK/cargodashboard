import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Returns the currently signed-in user, read from the same "token" cookie
// that /api/dashboard uses. Field names are read defensively because the
// shape of the token payload depends on what /api/auth/login signs.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = verifyToken(token) as unknown;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const p = payload as Record<string, any>;

    const email: string | null = p.email ?? null;
    const name: string =
      p.name ?? p.fullName ?? p.username ?? (email ? email.split("@")[0] : "User");

    return NextResponse.json({
      user: {
        id: p.id ?? p.userId ?? p.sub ?? null,
        name,
        email,
        role: p.role ?? null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
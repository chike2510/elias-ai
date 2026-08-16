import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ user: session ? { userId: session.userId, login: session.login, name: session.name, email: session.email, avatarUrl: session.avatarUrl, githubConnected: Boolean(session.githubConnected), vercelConnected: Boolean(session.vercelConnected) } : null });
}

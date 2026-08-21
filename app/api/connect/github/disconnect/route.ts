import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ connected: false, message: "Sign in to Elias first." }, { status: 401 });

  const { githubToken: _githubToken, githubConnected: _githubConnected, ...rest } = session;
  await setSession({ ...rest, githubConnected: false });
  return NextResponse.json({ connected: false });
}

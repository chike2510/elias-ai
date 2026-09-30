import { NextRequest } from "next/server";
import { getTaskForUser } from "@/lib/taskOrchestrator";
import { getSession } from "@/lib/auth";
import { getTaskArtifactBlob } from "@/lib/taskStore";

type Context = { params: Promise<{ taskId: string; artifactId: string }> };

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: Context) {
  const { taskId, artifactId } = await context.params;
  const session = await getSession();
  const task = await getTaskForUser(taskId, session?.userId);
  const artifact = task?.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return new Response("Artifact not found.", { status: 404 });
  let body: BodyInit;
  if (artifact.content !== undefined) body = artifact.encoding === "base64" ? Buffer.from(artifact.content, "base64") : artifact.content;
  else if (task?.videoGeneration && session?.userId) {
    const bytes = await getTaskArtifactBlob(taskId, artifactId, session.userId);
    if (!bytes) return new Response("Artifact not found.", { status: 404 });
    body = Uint8Array.from(bytes);
  } else return new Response("Artifact not found.", { status: 404 });
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": artifact.type || "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

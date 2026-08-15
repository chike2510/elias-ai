import { NextRequest } from "next/server";
import { getTask } from "@/lib/taskOrchestrator";

type Context = { params: Promise<{ taskId: string; artifactId: string }> };

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: Context) {
  const { taskId, artifactId } = await context.params;
  const task = getTask(taskId);
  const artifact = task?.artifacts.find((item) => item.id === artifactId);
  if (!artifact || artifact.content === undefined) return new Response("Artifact not found.", { status: 404 });
  const body = artifact.encoding === "base64" ? Buffer.from(artifact.content, "base64") : artifact.content;
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": artifact.type || "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

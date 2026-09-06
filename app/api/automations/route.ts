import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createAutomation, listAutomations, makeWebhookSecret } from "@/lib/automationStore";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const toolNames = new Set(["document.retrieval", "web.search", "web.open", "github.repository", "email.read", "email.draft", "sheets.read", "sheets.draft"]);

function cleanTools(value: unknown) {
  if (!Array.isArray(value)) return ["document.retrieval"];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && toolNames.has(item)))].slice(0, 12);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in is required.", 401, "UNAUTHENTICATED");
    return jsonOk({ automations: await listAutomations(session.userId) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not list automations.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in is required.", 401, "UNAUTHENTICATED");
    const body = await readJsonRequest<Record<string, unknown>>(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const objective = typeof body.objective === "string" ? body.objective.trim() : "";
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    if (!name || !objective || !instructions) return jsonError("name, objective, and instructions are required.", 400, "INVALID_REQUEST");
    if (name.length > 120 || objective.length > 6_000 || instructions.length > 12_000) return jsonError("Automation content is too large.", 413, "PAYLOAD_TOO_LARGE");
    const trigger = body.trigger === "manual" ? "manual" : "webhook";
    const approvalPolicy = body.approvalPolicy === "never" || body.approvalPolicy === "always" ? body.approvalPolicy : "risky";
    const webhookSecret = trigger === "webhook" ? makeWebhookSecret() : undefined;
    const result = await createAutomation({
      userId: session.userId,
      name,
      description: typeof body.description === "string" ? body.description.trim().slice(0, 500) : "",
      objective,
      instructions,
      trigger,
      approvalPolicy,
      allowedTools: cleanTools(body.allowedTools),
      preferredProvider: typeof body.preferredProvider === "string" ? body.preferredProvider : undefined,
      preferredModel: typeof body.preferredModel === "string" ? body.preferredModel.trim().slice(0, 180) : undefined,
      status: "active",
      webhookSecret,
    });
    const webhookUrl = trigger === "webhook" ? `${new URL(request.url).origin}/api/automations/${result.record.id}/trigger` : undefined;
    return jsonOk({ ...result, webhookUrl }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create automation.");
  }
}

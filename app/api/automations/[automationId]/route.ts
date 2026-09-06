import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { deleteAutomation, getAutomation, updateAutomation } from "@/lib/automationStore";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ automationId: string }> }) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in is required.", 401, "UNAUTHENTICATED");
    const { automationId } = await context.params;
    const automation = await getAutomation(automationId, session.userId);
    return automation ? jsonOk({ automation: { ...automation, userId: undefined, webhookSecretHash: undefined, hasWebhookSecret: Boolean(automation.webhookSecretHash) } }) : jsonError("Automation not found.", 404, "NOT_FOUND");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load automation.");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ automationId: string }> }) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in is required.", 401, "UNAUTHENTICATED");
    const body = await readJsonRequest<Record<string, unknown>>(request);
    const { automationId } = await context.params;
    const update: Record<string, unknown> = {};
    for (const field of ["name", "description", "objective", "instructions", "preferredProvider", "preferredModel", "status", "trigger", "approvalPolicy", "allowedTools"]) {
      if (field in body) update[field] = body[field];
    }
    const automation = await updateAutomation(automationId, session.userId, update as Parameters<typeof updateAutomation>[2]);
    return automation ? jsonOk({ automation }) : jsonError("Automation not found.", 404, "NOT_FOUND");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not update automation.");
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ automationId: string }> }) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in is required.", 401, "UNAUTHENTICATED");
    const { automationId } = await context.params;
    const deleted = await deleteAutomation(automationId, session.userId);
    return deleted ? jsonOk({ ok: true }) : jsonError("Automation not found.", 404, "NOT_FOUND");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not delete automation.");
  }
}

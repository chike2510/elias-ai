export { api } from "@/lib/chatClient";

const TOOLS: Record<string, string> = {
  memory_save: "Save memory", memory_update: "Update memory", memory_forget: "Forget memory",
  gmail_draft: "Draft email", gmail_send: "Send email", calendar_create: "Create event", calendar_delete: "Delete event",
  schedule_create: "Schedule task", schedule_update: "Change task", browser_click: "Browser click", browser_type: "Browser typing", browser_select: "Browser choice",
  github_issue_create: "Open GitHub issue", vercel_redeploy: "Vercel redeploy",
};
const STATUSES: Record<string, string> = { ok: "done", error: "failed", blocked: "refused", declined: "declined", pending_approval: "awaiting your OK" };

export const STATUS_TEXT = {
  tool: (tool: string) => TOOLS[tool] || tool.replace(/_/g, " "),
  status: (status: string) => STATUSES[status] || status,
};

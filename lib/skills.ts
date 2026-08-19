export type SkillStatus = "enabled" | "installed" | "needs_approval" | "disabled";
export type SkillContributor = { name: string; role: string; kind: "official" | "community" };

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  category: "official" | "community";
  status: SkillStatus;
  version: string;
  updatedAt: string;
  tools: string[];
  permissions: string[];
  contributors: SkillContributor[];
  evaluation: { cases: number; passRate: number };
};

export const SKILL_REGISTRY: SkillDefinition[] = [
  { id: "repository-code-review", name: "Repository Code Review", description: "Inspect source files, diffs, architecture, risks, and change impact with evidence.", category: "official", status: "enabled", version: "1.0.0", updatedAt: "2026-08-19", tools: ["github.repositories.read", "github.files.read", "review.generate", "impact.generate"], permissions: ["Repository read", "Review evidence"], contributors: [{ name: "Elias Core", role: "Maintainer", kind: "official" }], evaluation: { cases: 18, passRate: 0.89 } },
  { id: "document-intelligence", name: "Document Intelligence", description: "Extract, chunk, summarize, and answer questions from long documents.", category: "official", status: "enabled", version: "1.0.0", updatedAt: "2026-08-19", tools: ["documents.process", "documents.retrieve", "evidence.cite"], permissions: ["Library read", "Document processing"], contributors: [{ name: "Elias Core", role: "Maintainer", kind: "official" }], evaluation: { cases: 16, passRate: 0.91 } },
  { id: "web-research", name: "Web Research", description: "Search current sources, compare evidence, and produce cited research outputs.", category: "official", status: "installed", version: "0.9.0", updatedAt: "2026-08-18", tools: ["web.search", "web.open", "evidence.cite"], permissions: ["Web search", "External pages read"], contributors: [{ name: "Elias Core", role: "Maintainer", kind: "official" }], evaluation: { cases: 12, passRate: 0.84 } },
  { id: "autonomous-task-planner", name: "Autonomous Task Planner", description: "Turn objectives into visible steps, tool calls, approvals, and recoverable outputs.", category: "official", status: "enabled", version: "1.0.0", updatedAt: "2026-08-19", tools: ["agent.plan", "agent.execute", "approvals.request"], permissions: ["Task context", "Tool selection"], contributors: [{ name: "Elias Core", role: "Maintainer", kind: "official" }], evaluation: { cases: 20, passRate: 0.87 } },
  { id: "financial-analysis", name: "Financial Analysis", description: "Analyze company filings, market data, and investor materials with an evidence-first workflow.", category: "community", status: "needs_approval", version: "0.1.0", updatedAt: "2026-08-11", tools: ["web.search", "data.fetch", "spreadsheet.create"], permissions: ["Financial data read", "Report generation"], contributors: [{ name: "Community contributor", role: "Author", kind: "community" }], evaluation: { cases: 4, passRate: 0.72 } },
];

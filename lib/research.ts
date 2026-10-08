/**
 * Research reports: the prompt a research background job runs with, and a tolerant parser that
 * turns the job's markdown result into a Summary / Key findings / Sources card.
 * Pure (no server imports) so the Research screen and tests can use it too.
 */

export type ReportSource = { n: number; title: string; url: string; domain: string; note?: string };
export type ResearchReport = { summary: string; findings: string[]; sources: ReportSource[]; structured: boolean };

export const RESEARCH_FORMAT = `The final result (after STATUS: DONE) must use exactly this format:
## Summary
Two to four sentences that directly answer the question.
## Key findings
- One finding per bullet, 3 to 7 bullets, each ending with its source number(s) like [1] or [2, 3].
## Sources
1. [Page title](https://full.url) - publisher, date if known
Only list sources you actually opened, numbered to match the citations.`;

export function researchPrompt(question: string) {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 1500);
  return `Research this question and write a cited report: ${q}

Method: search at least three different angles, open the 4-8 strongest sources (prefer primary, official and recent ones), and cross-check every number and claim against a second source where you can. Note each source's URL as you go.

${RESEARCH_FORMAT}`;
}

function domainOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function clean(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}

const HEADING = /^\s*(?:#{1,6}\s*|\*\*)?\s*(summary|tl;?dr|answer|overview|key findings|findings|key points|details|sources|references|citations)\s*:?\s*(?:\*\*)?\s*:?\s*$/i;

function section(name: string): "summary" | "findings" | "sources" {
  const key = name.toLowerCase();
  if (/source|reference|citation/.test(key)) return "sources";
  if (/finding|point|detail/.test(key)) return "findings";
  return "summary";
}

function parseSourceLine(line: string, fallbackN: number): ReportSource | null {
  const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "");
  const numbered = line.match(/^\s*(?:\[(\d+)\]|(\d+)[.)])/);
  const n = Number(numbered?.[1] || numbered?.[2]) || fallbackN;
  const md = body.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
  if (md) {
    const note = clean(body.slice((md.index || 0) + md[0].length).replace(/^\s*[-–—:,]\s*/, ""));
    return { n, title: clean(md[1]), url: md[2], domain: domainOf(md[2]), ...(note ? { note } : {}) };
  }
  const bare = body.match(/https?:\/\/[^\s)>\]]+/);
  if (!bare) return null;
  const url = bare[0].replace(/[.,;]+$/, "");
  const title = clean(body.slice(0, bare.index).replace(/[-–—:(\s]+$/, "")) || domainOf(url);
  return { n, title, url, domain: domainOf(url) };
}

/** Parses a research job result. Never throws; unstructured text still yields a summary and any links found. */
export function parseReport(markdown: string): ResearchReport {
  const text = (markdown || "").replace(/\r/g, "");
  const buckets: Record<"summary" | "findings" | "sources" | "pre", string[]> = { summary: [], findings: [], sources: [], pre: [] };
  let current: keyof typeof buckets = "pre";
  let structured = false;
  for (const line of text.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) { current = section(heading[1]); structured = true; continue; }
    buckets[current].push(line);
  }
  const bullets = (lines: string[]) => lines.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).map((line) => clean(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))).filter(Boolean);
  const paragraphs = (lines: string[]) => lines.join("\n").split(/\n\s*\n/).map((block) => block.split("\n").filter((line) => !/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).join(" ")).map(clean).filter(Boolean);

  let sources: ReportSource[] = [];
  buckets.sources.forEach((line) => { const source = parseSourceLine(line, sources.length + 1); if (source) sources.push(source); });
  if (!sources.length) {
    const seen = new Set<string>();
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)>\]]+)/g)) {
      const url = (match[2] || match[3] || "").replace(/[.,;]+$/, "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ n: sources.length + 1, title: match[1] ? clean(match[1]) : domainOf(url), url, domain: domainOf(url) });
    }
  }
  sources = sources.slice(0, 20);

  const summaryLines = structured ? [...buckets.pre, ...buckets.summary] : buckets.pre;
  const summary = paragraphs(summaryLines).join("\n\n") || (structured ? "" : clean(text.split(/\n\s*\n/)[0] || ""));
  const findings = structured ? bullets(buckets.findings).concat(bullets(buckets.summary)) : bullets(buckets.pre);
  const tidy = (value: string) => value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  return { summary: tidy(summary), findings: findings.slice(0, 12).map(tidy), sources, structured };
}

/** The chat card for a finished research job: findings and sources (the summary is the chat bubble). */
export type ResearchReportCard = { kind: "report"; title: string; jobId: string; summary: string; findings: string[]; sources: ReportSource[] };

/** Builds the report card for a research job result, or null when there is nothing beyond a plain answer. */
export function reportCardFor(title: string, jobId: string, markdown: string): ResearchReportCard | null {
  const report = parseReport(markdown);
  if (!report.findings.length && !report.sources.length) return null;
  return { kind: "report", title, jobId, summary: report.summary, findings: report.findings, sources: report.sources };
}

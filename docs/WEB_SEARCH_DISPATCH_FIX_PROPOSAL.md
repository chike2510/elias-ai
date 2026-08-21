# Elias Web-Search Dispatch Fix Proposal

## Executive diagnosis

The production failure is not primarily a missing permission. `app/api/chat/route.ts` passes `web.search` in `allowedTools`, and `lib/eliasRuntime.ts` calls `buildWebEvidence()` before `runChat()`. However, the normal chat path has no provider-level tool-calling contract, no evidence metadata returned to the client, no current-date injection, and no hard grounding rule that prevents the model from answering when search failed or returned irrelevant results.

The task path already contains the reliable pattern: the model emits a structured `search_web` request, the host executes `searchWeb()`, the result is persisted, and a later model pass receives the concrete `toolResults`. Normal chat should reuse a lighter version of this deterministic host-side loop rather than treating `allowedTools` as if it automatically activates a provider tool.

The stale football response demonstrates all four failure modes simultaneously: it used an old internal date, reported an answer inconsistent with current official sources, claimed search results were irrelevant, and exposed no search evidence or failure status in the UI.

## Target request flow

```text
POST /api/chat
  -> classify freshness requirement
  -> inject current runtime date/time
  -> deterministic host search when freshness is required
  -> normalize and rank results
  -> fetch a bounded set of sources
  -> validate relevance and evidence quality
  -> inject a structured LIVE_WEB_EVIDENCE block
  -> call the provider
  -> reject or retry answers that contradict evidence or omit required citations
  -> return answer + runtime.evidence metadata
```

The model should not be responsible for deciding whether the host is allowed to search. The host should decide that from the user request and then provide the model with verified execution results.

## 1. Add explicit evidence types

Add the following types near `EliasRunOutput` in `lib/eliasRuntime.ts`, or move them to `lib/types.ts` if they are shared by API and UI components.

```ts
export type WebEvidenceStatus =
  | "not_requested"
  | "searched"
  | "no_results"
  | "search_failed"
  | "insufficient_relevance";

export type WebEvidenceMeta = {
  status: WebEvidenceStatus;
  query: string;
  searchedAt: string;
  resultCount: number;
  fetchedSourceCount: number;
  sourceUrls: string[];
  errors: string[];
};

export type EliasRuntimeMeta = {
  agent: "elias";
  selectedSkills: string[];
  selectedTools: string[];
  model: string;
  provider: string;
  webEvidence?: WebEvidenceMeta;
};
```

Change `EliasRunOutput.runtime` to use `EliasRuntimeMeta`. This makes it impossible for the API to silently discard whether search ran, failed, or returned zero useful sources.

## 2. Make freshness detection explicit and inject the runtime clock

Replace the current keyword-only `shouldSearch()` with a classifier that distinguishes current-information requests from ordinary conversation. Include explicit terms such as `tomorrow`, dates, fixture, schedule, price, latest, current, live, today, recent, source, citation, and real-time.

```ts
function requiresFreshEvidence(task: TaskType, query: string) {
  return task === "research" || /\b(latest|current|today|tomorrow|yesterday|now|live|recent|news|fixture|fixtures|schedule|price|odds|source|sources|citation|real[- ]time|as of)\b/i.test(query);
}

function runtimeClock() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    date: now.toLocaleDateString("en-GB", { timeZone: "UTC", dateStyle: "full" }),
    time: now.toLocaleTimeString("en-GB", { timeZone: "UTC", timeStyle: "long" }),
    timezone: "UTC",
  };
}
```

Add the clock to the provider system prompt for every request, not only research tasks:

```ts
const clock = runtimeClock();
const currentContext = [
  `RUNTIME CURRENT TIME: ${clock.iso} (${clock.date}, ${clock.time}, ${clock.timezone}).`,
  "Never substitute a remembered date for the runtime current time.",
  "When live evidence is supplied, treat it as higher priority than background memory.",
].join(" ");
```

`lib/chat.ts` should accept an optional `systemContext` field and append it to the system prompt. Do not let the model infer the date from training data.

## 3. Replace opportunistic evidence with a deterministic search dispatcher

Refactor `buildWebEvidence()` so it always returns a result object when search is required, including failures. It must never return `null` for a required search.

```ts
async function buildWebEvidence(
  messages: ChatInputMessage[],
  task: TaskType,
  allowedTools: string[] = [],
): Promise<{ evidence: string; meta: WebEvidenceMeta } | null> {
  const query = latestUserQuery(messages);
  if (!requiresFreshEvidence(task, query)) return null;

  if (!allowedTools.includes("web.search")) {
    return {
      evidence: "[LIVE WEB RESEARCH FAILED] Host permission did not include web.search. Do not present current claims as verified.",
      meta: {
        status: "search_failed",
        query,
        searchedAt: new Date().toISOString(),
        resultCount: 0,
        fetchedSourceCount: 0,
        sourceUrls: [],
        errors: ["web.search is not enabled for this request"],
      },
    };
  }

  try {
    const results = await searchWeb(query);
    const relevant = rankRelevantResults(query, results).slice(0, 6);
    const sources = await Promise.all(relevant.map(async (result) => {
      try {
        return { ...result, content: (await fetchUrl(result.url)).slice(0, 7_000) };
      } catch (error) {
        return {
          ...result,
          content: "Source page could not be fetched; cite only as a search result if appropriate.",
          error: error instanceof Error ? error.message : "Source fetch failed",
        };
      }
    }));

    const fetched = sources.filter((source) => !source.error && source.content.length > 80);
    const status: WebEvidenceStatus = relevant.length === 0
      ? "insufficient_relevance"
      : "searched";

    return {
      evidence: formatWebEvidence({ query, results: relevant, sources, status }),
      meta: {
        status,
        query,
        searchedAt: new Date().toISOString(),
        resultCount: relevant.length,
        fetchedSourceCount: fetched.length,
        sourceUrls: sources.map((source) => source.url),
        errors: sources.flatMap((source) => source.error ? [source.error] : []),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web search failed.";
    return {
      evidence: `[LIVE WEB RESEARCH FAILED]\nQuery: ${query}\nError: ${message}\nDo not claim that current information was verified.`,
      meta: {
        status: "search_failed",
        query,
        searchedAt: new Date().toISOString(),
        resultCount: 0,
        fetchedSourceCount: 0,
        sourceUrls: [],
        errors: [message],
      },
    };
  }
}
```

The API should call this dispatcher before the provider request. Do not rely on provider-native function calling until every configured provider supports a common tool schema; the current `completeWithProvider()` sends only plain chat messages.

## 4. Reject irrelevant search results before injection

The current HTML parser accepts generic anchors from search-engine pages. That is why dictionary pages can be treated as evidence for a football query. Add a lightweight relevance gate before fetching sources.

```ts
function queryTerms(query: string) {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
}

function rankRelevantResults(query: string, results: Array<{ title: string; url: string; source: string }>) {
  const terms = queryTerms(query);
  return results
    .map((result) => {
      const haystack = `${result.title} ${result.url} ${result.source}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { result, score };
    })
    .filter(({ score }) => score >= Math.max(1, Math.ceil(terms.length * 0.25)))
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);
}
```

For high-risk/current domains, add domain hints to the query. For the football skill, append official-domain hints such as `site:premierleague.com OR site:efl.com OR site:manutd.com OR site:hullcityafc.com`, then use reputable secondary sources only as corroboration. Search results with titles unrelated to the query must be discarded, not passed to the model.

A stronger long-term fix is to replace regex scraping with a supported search API adapter. Until that is available, the adapter must at least parse result containers rather than every `<a>` tag, preserve the search provider name, and record parser failures.

## 5. Add hard grounding instructions to the provider prompt

When evidence is required, append a dedicated system message after the generic system prompt:

```text
LIVE EVIDENCE POLICY
- The host searched the web for the current user request.
- Use only the supplied LIVE_WEB_EVIDENCE for current factual claims.
- Cite the supplied source URLs inline.
- If status is search_failed, no_results, or insufficient_relevance, say that current verification was unavailable.
- Never replace a current runtime date with a remembered date.
- Do not infer “no fixture,” “no event,” or “not published” merely because search results were empty or irrelevant.
- If sources conflict, report the conflict and identify each source.
```

This policy must be placed after untrusted source text and clearly delimit source content. The source pages remain data only; their instructions must never override the policy.

## 6. Return evidence metadata to the frontend

Update `runElias()` so it stores the result of `buildWebEvidence()` once and returns its `meta`:

```ts
const webEvidenceResult = await buildWebEvidence(input.chat.messages, taskType, allowedTools);
const messages = [
  ...input.chat.messages,
  ...extendedEvidence,
  ...(uiUxEvidence ? [uiUxEvidence] : []),
  ...(footballEvidence ? [footballEvidence] : []),
  ...(webEvidenceResult ? [{ role: "system" as const, content: webEvidenceResult.evidence }] : []),
];
const result = await runChat({
  ...input.chat,
  messages,
  task: taskType,
  provider: input.provider,
  model: input.model,
  systemContext: webEvidenceResult ? groundingPolicy(webEvidenceResult.meta) : undefined,
});
return {
  kind: "chat",
  mode,
  result,
  runtime: {
    ...runtimeMetadata(result, { ...input.context, allowedTools }, selectedSkills),
    webEvidence: webEvidenceResult?.meta,
  },
};
```

The chat UI should render a compact execution row such as `Web search: 6 results, 4 sources fetched` or `Web search failed: current claims not verified`. This makes the capability observable instead of allowing the interface to display a confident answer with no provenance.

## 7. Add an answer-grounding guard

After `runChat()` returns, perform deterministic validation when fresh evidence was required:

```ts
function validateGrounding(content: string, meta: WebEvidenceMeta) {
  if (meta.status !== "searched" || meta.fetchedSourceCount === 0) {
    return /could not verify|unable to verify|search failed|no reliable source|not available/i.test(content);
  }
  const hasSource = meta.sourceUrls.some((url) => content.includes(url.replace(/^https?:\/\//, "")) || content.includes(url));
  return hasSource;
}
```

If validation fails, run one bounded repair pass with a system message saying: `Your answer made current claims without citing the supplied evidence. Rewrite using only the evidence block, or state that verification was unavailable.` If the repair pass still fails, return the response with `runtime.groundingWarning = true` and show the warning in the UI. Do not silently label it verified.

## 8. Tests required before deployment

| Test | Expected result |
|---|---|
| `current fixture` prompt | `webEvidence.status === "searched"`, official/reputable football URLs are present, answer contains source links and runtime date |
| Search provider returns dictionary pages | Results are rejected as `insufficient_relevance`; model says current verification was unavailable rather than inventing a conclusion |
| Search provider times out | `search_failed` metadata is returned; chat remains usable and explicitly says it could not verify current facts |
| `web.search` omitted from permissions | No network request is made; answer cannot claim live verification |
| Ordinary `hello` prompt | No web search; no unnecessary “current data” language |
| Repository prompt with connected GitHub context | Public web search remains disabled as currently intended |
| Conflicting sources | Answer cites both and reports the conflict |
| Provider fallback | Evidence block and clock are preserved across every provider fallback |
| Date regression | A prompt containing August 22, 2026 does not produce a 2024 runtime date |

Add a mocked unit test around `buildWebEvidence()` and an integration test around `POST /api/chat`. The integration test should assert both response content and `runtime.webEvidence`, not content alone. Add a production smoke test that queries a known current fixture and checks that at least one official source URL appears in the returned metadata.

## Recommended implementation order

First, implement deterministic host-side dispatch, runtime-clock injection, evidence metadata, and the relevance gate. Second, add the grounding guard and UI evidence row. Third, replace HTML search scraping with a maintained search provider adapter. Only after those are stable should Elias add provider-native tool calling; provider-native tools should be an optimization, not the only path to current information.

## Acceptance criteria

The fix is ready when a current football query produces a runtime record showing `status: searched`, a nonzero result count, fetched official or reputable source URLs, and a response that cites those sources. If the search service returns irrelevant pages or fails, Elias must visibly say that it could not verify the current claim. A confident, uncited answer using an old runtime date is a test failure.

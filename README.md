# ELIAS

ELIAS is a mobile-first AI workspace for conversational assistance, project inspection, code editing, live-source research, document extraction, and artifact packaging. The project is built as a Next.js App Router application for Vercel.

## What is implemented

- Conversation creation, URL-addressable conversation IDs, IndexedDB history, switching, deletion, ordered messages, retry, stop generation, provider/model metadata, markdown, code blocks, and copy controls.
- Server-side multi-provider routing for Qwen, AgentRouter, Cerebras, Groq, OpenRouter, Mistral, and GitHub Models where configured.
- Provider normalization for JSON, plain-text failures, SSE content, timeouts, rate limits, malformed responses, and fallback providers.
- A validated autonomous agent protocol for inspecting a workspace, listing and reading files, searching files, inspecting dependencies, researching the web, fetching safe public URLs, creating text artifacts, writing/appending/editing/renaming/deleting files, and exporting a real ZIP.
- Real ZIP import with path-traversal rejection, editable text-file extraction, file-tree browsing, editor updates, agent actions, and artifact downloads.
- Live web search plus source opening with source URLs, bounded readable excerpts, timeout controls, content-type checks, and SSRF protections.
- PDF, DOCX, XLSX, XLS, CSV, and text extraction with a bounded upload size.
- Browser voice recognition with transcript review and chat handoff, camera preview, and local JPEG snapshot artifacts.

## Provider configuration

Set only the provider keys you actually use in Vercel Environment Variables. Keys remain server-side and are never read by client-side code.

```text
QWEN_API_KEY=
AGENTROUTER_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
GITHUB_TOKEN=
```

## Honest deployment boundary

The current project does not include a database, object storage binding, or an isolated shell worker. Conversations, projects, workspace files, and artifacts are persistent in the current browser through IndexedDB, but they are not yet shared across devices or users. The agent therefore does not claim to run npm, builds, tests, lint, git, or arbitrary commands. Those capabilities can be added behind the existing tool protocol using an isolated worker without rewriting the UI.

Image analysis and video description are intentionally marked unavailable because no compatible vision/video model route is configured. Camera capture and browser speech recognition are real browser capabilities, subject to permission and browser support.

## Development

```bash
npm install
npm run build
```

The `/chat` route remains wrapped in a Suspense boundary so `useSearchParams()` satisfies the current Next.js prerender requirement.

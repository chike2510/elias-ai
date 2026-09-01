# ELIAS

ELIAS is a mobile-first intelligence workbench for turning objectives into plans, verified operations, and recoverable deliverables. It is a Next.js App Router application that can run on Vercel for coordination and browser-first experiences, with an optional trusted worker for command validation.

## What is implemented

The primary experience is the `/tasks` workbench. A user starts with an outcome, ELIAS infers a task kind, creates a plan, shows permissions, records activity and evidence, creates checkpoints around workspace mutations, exposes approvals, and associates generated artifacts with the task. Recent tasks are addressable by URL and can be resumed through the task detail API.

The chat, coding, research, files, and Studio surfaces remain available as specialist workspaces. The coding editor can hand an imported project into the task workbench, and the task workbench can open the current task workspace in the editor. Research and voice transcripts can be handed directly into a task objective. Generated text artifacts can be downloaded from the task delivery panel.

The server provides normalized multi-provider routing for Qwen, AgentRouter, Cerebras, Groq, OpenRouter, Mistral, and GitHub Models where configured. Provider responses are read text-first and normalized across JSON, SSE, plain-text failures, timeouts, malformed responses, and fallback providers. API routes return a stable `{ ok, ... }` response envelope, and client readers tolerate non-JSON failures.

The agent protocol supports workspace inspection, file listing and reading, file search, dependency inspection, bounded web search and source opening, text artifact creation, validation requests, and workspace actions for writing, appending, editing, renaming, and deleting files. ZIP import rejects traversal paths, extracts bounded editable text files, and the existing editor can export the real current workspace.

Live research provides bounded sources and excerpts with SSRF protection, timeout controls, content-type checks, source-opening errors, and a handoff into durable research tasks. Studio provides browser speech recognition with visible transcript review, direct task/chat handoff, camera preview, and local JPEG snapshot artifacts. Image analysis and video description are visibly unavailable when no compatible vision/video route is configured.

## Task persistence and execution

Task state is stored through a server-side adapter in `lib/taskStore.ts`. For local or trusted-worker deployments it uses `ELIAS_TASK_STORE_PATH`, defaulting to `.elias/tasks.json`, and refreshes the file on reads so separate Next.js route-handler processes can see the same task state. The `.elias` directory is ignored by source control. On Vercel or another stateless serverless host, configure a real database adapter for shared multi-instance durability; the included file adapter is not a replacement for production database or object-storage infrastructure.

Validation commands are implemented in `lib/execution.ts` but are disabled by default. Set `ELIAS_EXECUTION_ENABLED=true` only on a trusted isolated worker with resource, filesystem, network, and process limits. The worker writes the task workspace to a temporary directory, uses an allowlisted command map, disables shell interpolation, limits runtime and output, and removes the temporary directory after each check. Ordinary Vercel functions should leave this flag false.

## Environment configuration

Set only the provider keys you actually use on the server. Keys are never read by client-side code. `GITHUB_LOGIN_CLIENT_ID` and `GITHUB_LOGIN_CLIENT_SECRET` are used only for Elias account sign-in; `GITHUB_REPO_CLIENT_ID` and `GITHUB_REPO_CLIENT_SECRET` are used only for the separate repository connector flow.

```text
QWEN_API_KEY=
AGENTROUTER_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
GITHUB_LOGIN_CLIENT_ID=
GITHUB_LOGIN_CLIENT_SECRET=
GITHUB_REPO_CLIENT_ID=
GITHUB_REPO_CLIENT_SECRET=
GITHUB_TOKEN=

# Optional local/trusted-worker task persistence.
ELIAS_TASK_STORE_PATH=.elias/tasks.json

# Only enable on an isolated trusted execution worker.
ELIAS_EXECUTION_ENABLED=false
```

## Architecture

The main flow is:

```text
objective
  → task record and plan
  → permission / approval policy
  → normalized agent step
  → bounded tool or workspace action
  → evidence event and tool result
  → checkpoint and validation
  → artifact delivery and final report
```

The task API is available at `/api/tasks`, `/api/tasks/[taskId]`, `/api/tasks/[taskId]/step`, and `/api/tasks/[taskId]/artifact/[artifactId]`. The full boundary and adapter design is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development

```bash
npm install
npm run typecheck
npm run build
```

The supplied project does not define `lint` or `test` scripts. The `/chat` route remains wrapped in a Suspense boundary so `useSearchParams()` satisfies the current Next.js prerender requirement.

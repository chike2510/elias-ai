# ELIAS architecture

## Product model

ELIAS is organized around a task rather than a message. Chat, coding, research, Studio, files, and study are specialist entry points into the same objective-first workbench.

```text
objective
  → task record
  → plan and permissions
  → agent step
  → bounded tool request or workspace action
  → evidence event / tool result
  → checkpoint and validation
  → artifact delivery
  → final report
```

The task record contains the objective, inferred kind, plan steps, permissions, approvals, checkpoints, workspace snapshot, tool results, activity events, artifacts, and lifecycle status. The main UI is `components/screens/TaskWorkspace.tsx`, exposed at `/tasks`.

## Request and provider flow

```text
Browser UI
  → Next.js route handler
  → validated request envelope
  → task orchestrator
  → normalized provider adapter
  → model provider with server-side key
  → validated agent output
  → bounded tool/action executor
  → task event ledger and artifact store
  → UI
```

The provider layer is centralized in `lib/providers.ts`. It owns provider configuration, model discovery, task routing, fallback order, timeout handling, plain-text/JSON/SSE normalization, and provider error conversion. Provider keys remain server-side.

All JSON API routes use `{ ok: true, ...data }` for success and `{ ok: false, error: { code, message } }` for failures. Client requests use `lib/clientApi.ts`, which reads the response body as text first. Provider responses use the same text-first rule in `readProviderResponse`, so a plain-text gateway error cannot be passed to a JSON parser by mistake.

## Task state and persistence

`lib/task.ts` defines the task contract. `lib/taskStore.ts` implements the adapter boundary and lifecycle operations for task creation, retrieval, updates, activity events, approvals, permissions, checkpoints, workspace restoration, and tool results. The included adapter uses a process-safe JSON file at `ELIAS_TASK_STORE_PATH` or `.elias/tasks.json`; it refreshes the file on reads so separate Next.js route-handler processes can observe the same local task state.

This file adapter is appropriate for local development or a trusted worker with a persistent filesystem. It is intentionally not described as a production multi-user database. A production deployment should replace the adapter with a transactional database and object storage binding, while preserving the task contract and API routes.

The task routes are:

| Route | Purpose |
|---|---|
| `/api/tasks` | List and create tasks with validated objectives and bounded workspace snapshots |
| `/api/tasks/[taskId]` | Read task state, approve/reject requests, pause, cancel, or restore checkpoints |
| `/api/tasks/[taskId]/step` | Execute one or more bounded task steps and return updated evidence |
| `/api/tasks/[taskId]/artifact/[artifactId]` | Download bounded text artifacts associated with a task |

## Permissions and recovery

Read access is the only broadly automatic capability. Network access is granted by policy for research tasks; write and command execution permissions require explicit configuration or user approval. External side effects are represented in the contract but are not silently executed.

Before workspace mutations the orchestrator captures a checkpoint. It captures a second checkpoint after the mutation and records each action as a diff-oriented evidence event. The task workbench exposes pending approvals, checkpoint history, restore actions, pause, and cancellation. The event ledger is the source of truth for what ELIAS actually did; model narration is not treated as evidence.

## Agent protocol and tools

`lib/agent.ts` validates provider output into a request/action protocol. Requests cover project inspection, file listing and reading, file search, dependency inspection, bounded validation, web search, safe URL opening, and text artifact creation. Actions cover write, append, bounded edit, rename, and delete operations. `lib/taskOrchestrator.ts` enforces request permissions, executes the supported tools, records results, and updates task state.

The current Next.js host does not expose a general shell or isolated process worker by default. `lib/execution.ts` therefore keeps command execution disabled unless `ELIAS_EXECUTION_ENABLED=true`. When enabled on a trusted isolated worker, it writes bounded task files to a temporary directory, uses an allowlisted command map (`build`, `typecheck`, `lint`, `test`), avoids shell interpolation, limits runtime/output, and removes the directory afterward. Ordinary Vercel functions should keep this flag false.

## Workspace and artifacts

The coding workspace imports ZIP files with traversal checks, filters editable text files, persists browser-local project files through IndexedDB, and exports the actual current tree. A task opened from the coding workspace receives a server-side workspace snapshot. A task-created artifact is stored with bounded text content, preview metadata, MIME type, and a task-scoped download route.

Browser IndexedDB remains the local store for conversations, projects, files, and camera artifacts. The server task adapter is separate so the task API has a clear persistence boundary. It does not falsely imply that browser-local data is shared across devices.

## Research and evidence

`search_web` and `fetch_url` execute server-side. Search results include source URLs and hostnames. URL fetching accepts HTTP(S), rejects credentials, blocks local/private destinations, disallows redirects, applies timeouts and size limits, and reads only text-like content types. The Research screen presents bounded excerpts and can hand a research objective into the task workbench for a durable evidence trail.

## Multimodal inputs

Studio integrates browser capabilities into the task model rather than claiming unsupported model features. Speech recognition creates a visible transcript that can become a task objective or chat prompt. Camera capture creates a local JPEG artifact. Image analysis and video description are visibly marked unavailable until a compatible vision/video provider route is configured.

## Design system

The task workbench uses calm operational clarity: graphite surfaces, restrained violet focus states, warm neutral text, compact metadata typography, thin structural borders, monospace evidence blocks, state-specific dots, and responsive panels. The user always sees the objective, task status, plan progress, permissions, live evidence, checkpoints, and artifacts. The design treats chat as an input surface and the task workspace as the product.

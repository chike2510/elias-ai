# ELIAS architecture

## Request flow

```text
Browser UI
  -> Next.js route handler
  -> validated request envelope
  -> ELIAS orchestrator / task router
  -> normalized provider adapter
  -> model provider with server-side key
  -> normalized assistant response
  -> agent state / conversation / artifacts
  -> UI
```

The provider layer is centralized in `lib/providers.ts`. It owns provider configuration, model discovery, task routing, fallback order, timeout handling, plain-text/JSON/SSE normalization, and provider error conversion. The browser never receives provider credentials.

All JSON API routes use `{ ok: true, ...data }` for success and `{ ok: false, error: { code, message } }` for failures. Client requests use `lib/clientApi.ts`, which reads the response body as text first and therefore cannot accidentally call `JSON.parse()` on an arbitrary plain-text error body. Provider responses use the same text-first rule in `readProviderResponse`.

## Agent protocol

`lib/agent.ts` produces validated requests and actions. The coding workspace executes only the operations it actually supports: project inspection, file listing/reading/search, dependency inspection, web search, safe URL reading, artifact creation, file writes, appends, bounded text edits, renames, and deletes. Each executed tool produces a result with a type, optional ID, timestamps, result or error, and the UI records the operation as a real tool event.

The current Vercel-compatible host does not expose an isolated shell worker. ELIAS therefore does not claim to run npm, builds, tests, lint, git, or arbitrary server commands. A future sandbox worker can implement those tools behind the same protocol without changing the chat UI.

## Workspace and artifacts

ZIP import and export use JSZip and operate on actual editable text files. ZIP paths are normalized and traversal entries are rejected. Generated text artifacts and exported ZIPs are stored as real IndexedDB records and are downloadable from the Files screen. The current storage is device-persistent IndexedDB; it survives refreshes on the same browser but is not yet multi-device or server-backed.

## Research safety

`search_web` and `fetch_url` are server-side. Search results include source URLs and hostnames. URL fetching accepts only HTTP(S), blocks local/private network destinations, rejects embedded credentials, disallows redirects, applies timeouts and response-size limits, and only reads text-like content types.

## Media capabilities

The Studio page exposes browser speech recognition and microphone transcript handoff where the browser supports it. Camera capture is real and saves local JPEG artifacts. Video description and image analysis are explicitly unavailable unless a compatible model route is configured; the UI no longer presents them as working actions.

# ELIAS — autonomous coding agent

ELIAS is a mobile-first autonomous workspace built on Next.js. It is designed around long-form project work rather than one giant chat response.

## what works

- import a codebase as ZIP
- add individual files
- browse and edit the workspace
- ask ELIAS to implement/refactor/debug across files
- iterative agent loop (up to 12 steps per request)
- file reads, writes, appends, renames and deletes
- large-file edits can be split across append actions
- live web search and URL reading during agent tasks
- PDF/DOCX/XLSX/XLS/CSV/TXT/MD ingestion
- GitHub repository metadata lookup
- camera/photo input hook
- browser voice/camera studio
- export the resulting workspace as a ZIP
- multi-provider routing with server-side API keys

## provider configuration

Add any keys you actually have in Vercel Environment Variables:

```text
QWEN_API_KEY=
AGENTROUTER_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
GITHUB_TOKEN=
```

You do not need to enter model IDs or base URLs. ELIAS owns those settings and can query provider model catalogs where supported.

## routing strategy

Qwen is preferred for coding when available. Cerebras/OpenRouter are used for fast general work, while AgentRouter is reserved as a stronger fallback for difficult tasks. Mistral, GitHub Models and Groq are additional fallbacks.

## important limitation

Vercel serverless functions are not a safe replacement for a persistent arbitrary shell. This version therefore does not pretend to run `npm install`, builds, tests or git commands. The agent edits the imported workspace and exports it.

For a true Claude-Code-class autonomous system, the next infrastructure layer is an isolated sandbox worker that receives the same agent actions and can run:

- npm/pnpm/yarn install
- builds and tests
- lint/typecheck
- git diff/status/commit
- repository checkout/push
- preview builds

The UI and agent protocol are already structured for that sandbox layer.

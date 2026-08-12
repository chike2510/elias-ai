# ELIAS AI — finished mobile-first frontend + provider foundation

ELIAS is designed as an intelligence workspace rather than a chatbot wrapper.

## included screens

1. Home
2. Conversation
3. Project workspace
4. Code workbench
5. Agent activity
6. Research
7. Study / documents
8. Artifacts / files
9. Voice + camera
10. Projects

## working now

- mobile-first responsive UI
- navigation between all core screens
- chat API with provider routing and fallback
- Qwen / AgentRouter / Groq / OpenRouter / Cerebras / Mistral / GitHub Models adapters
- file uploads in study/files flows
- local project file state through localStorage
- editable code workbench
- ZIP export of project/artifact files in the browser
- camera preview using getUserMedia
- browser speech recognition when supported
- research route that can use a research-capable configured model
- server-side API keys; no keys in client code

## deliberately not faked

ELIAS does not pretend that a provider searched the web, modified a repository, ran a build, or executed code unless the relevant infrastructure exists. Those are shown as agent capabilities/UI, while the current starter uses safe placeholders where external infrastructure is not connected yet.

## install

```bash
npm install
npm run dev
```

## deploy to Vercel

1. import the repository
2. add the variables from `.env.example`
3. set `ELIAS_PROVIDER_ORDER`
4. deploy

### examples

```text
ELIAS_PROVIDER_ORDER=qwen,openrouter,cerebras,groq,agentrouter,mistral,github

QWEN_API_KEY=...
QWEN_BASE_URL=...
QWEN_MODEL=...

AGENTROUTER_API_KEY=...
AGENTROUTER_BASE_URL=...
AGENTROUTER_MODEL=...

GROQ_API_KEY=...
GROQ_MODEL=...

OPENROUTER_API_KEY=...
OPENROUTER_MODEL=...

CEREBRAS_API_KEY=...
CEREBRAS_MODEL=...

MISTRAL_API_KEY=...
MISTRAL_MODEL=...

GITHUB_MODELS_TOKEN=...
GITHUB_MODELS_MODEL=...
```

Use the exact model IDs and base URLs shown in each provider's current dashboard.

## next infrastructure layer

For a production coding agent, connect:

- GitHub App / OAuth
- object storage
- database
- repository indexing
- code sandbox / isolated execution
- structured tool-calling
- artifact service
- real web search provider
- document extraction + RAG
- streaming responses
- auth / rate limiting
- usage and provider quota telemetry

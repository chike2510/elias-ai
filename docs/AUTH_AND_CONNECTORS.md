# Elias account and connector setup

Elias now uses GitHub OAuth for account creation and sign-in. GitHub repository access and Vercel access are separate connector permissions started from the Chat **+ add** menu.

## Required environment variables

Configure these values in the local `.env.local` file and in the Vercel project environment settings. Do not commit secrets.

```text
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ELIAS_SESSION_SECRET=use-a-long-random-value-at-least-32-characters
VERCEL_MCP_URL=https://your-vercel-mcp-server.example.com/api/mcp
VERCEL_MCP_AUTHORIZATION=Bearer <server-side-token>
```

`ELIAS_SESSION_SECRET` encrypts the HttpOnly Elias session cookie. The current prototype stores the authorized provider tokens inside that encrypted cookie so the connector flow works without introducing a database. For production scale, move user and connector records into a server-side database and store only an opaque session identifier in the cookie.

## GitHub OAuth App

Create a GitHub OAuth App under **Settings → Developer settings → OAuth Apps**. Use the deployed Elias origin and register this callback URL:

```text
https://YOUR-ELIAS-DOMAIN/api/auth/github/callback
```

The same OAuth App is used when the user later chooses **+ add → Connect GitHub**. That second flow requests repository access and returns through:

```text
https://YOUR-ELIAS-DOMAIN/api/connect/github/callback
```

The initial sign-in requests only `read:user user:email`. The separate repository connection requests `repo read:org`. This separation means account identity is not automatically treated as permission to read or modify repositories.

## Model providers

Elias supports provider-backed model routing through the configured OpenAI-compatible providers. Add the relevant provider API keys to Vercel to make their live models available through `/api/models` and the Chat model picker. Auto mode preserves task-based routing; an explicit provider/model selection is carried into both Chat and autonomous task execution.

Supported provider environment variables include `QWEN_API_KEY`, `AGENTROUTER_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, and `GITHUB_TOKEN` where applicable.

## Vercel as an MCP connector

Elias does **not** use Vercel as an account sign-in provider. The previous `/api/connect/vercel` OAuth redirect has been removed because it sent users to `https://vercel.com/oauth/authorize` and incorrectly treated a service connector as end-user authentication.

The intended architecture is an MCP host/client connection. Elias’s server calls a configured Vercel MCP endpoint, discovers available tools, and invokes those tools only from authenticated server routes. The browser never receives the MCP credential and never redirects the user to a Vercel login screen.

Configure the server-only bridge values:

```text
VERCEL_MCP_URL=https://your-vercel-mcp-server.example.com/api/mcp
VERCEL_MCP_AUTHORIZATION=Bearer <server-side-token>
```

Alternatively, set `VERCEL_MCP_TOKEN` to the raw token. The endpoint must support Streamable HTTP JSON-RPC and the standard `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` methods.

From Chat, the user opens **+ add** and chooses **Connect Vercel via MCP**. Elias calls `POST /api/connect/vercel`, checks the server-side MCP bridge, and reports the discovered tool count. If the endpoint is missing or unreachable, the interface shows a configuration state instead of sending the user to a broken OAuth page.

## User flow

A new user visits Elias and is sent to `/login`. **Continue with GitHub** creates the Elias session from the GitHub identity. The workbench then starts empty: no sample conversations, projects, tasks, or connected services are shown.

From Chat, the user opens **+ add** and chooses **Connect GitHub** or **Connect Vercel via MCP**. GitHub remains a user-granted repository connector. Vercel is handled through the server-side MCP bridge and is not a second Elias login. Project screens should display real resources only after the relevant connector has been validated.

# Elias account and connector setup

Elias now uses GitHub OAuth for account creation and sign-in. GitHub repository access and Vercel access are separate connector permissions started from the Chat **+ add** menu.

## Required environment variables

Configure these values in the local `.env.local` file and in the Vercel project environment settings. Do not commit secrets.

```text
GITHUB_LOGIN_CLIENT_ID=...
GITHUB_LOGIN_CLIENT_SECRET=...
GITHUB_REPO_CLIENT_ID=...
GITHUB_REPO_CLIENT_SECRET=...
ELIAS_SESSION_SECRET=use-a-long-random-value-at-least-32-characters
VERCEL_MCP_URL=https://elias-ai-chi.vercel.app/api/mcp/vercel
# Optional service configuration; user credentials are collected per Elias account.
VERCEL_MCP_TOKEN=<bridge-secret-if-using-an-external-MCP-client>
VERCEL_API_TOKEN=<not-used-as-a-shared-production-secret>
```

`ELIAS_SESSION_SECRET` encrypts the HttpOnly Elias session cookie. Repository OAuth tokens are encrypted and stored in the server-side GitHub connection store when durable storage is available; a repository-only token is also retained in the encrypted session as a fallback for deployments without `POSTGRES_URL`. The login OAuth token is used only during sign-in to read the GitHub profile and email, and is never treated as repository access.

## GitHub OAuth App

Create a GitHub OAuth App under **Settings → Developer settings → OAuth Apps**. Use the deployed Elias origin and register this callback URL:

```text
https://YOUR-ELIAS-DOMAIN/api/auth/github/callback
```

Create a second GitHub OAuth App for repository access. The login flow uses `GITHUB_LOGIN_CLIENT_ID` and `GITHUB_LOGIN_CLIENT_SECRET`; the **+ add → Connect GitHub** flow uses `GITHUB_REPO_CLIENT_ID` and `GITHUB_REPO_CLIENT_SECRET`. Both OAuth Apps must register the shared callback URL because the callback handler selects the client credentials from the signed OAuth state:

```text
https://YOUR-ELIAS-DOMAIN/api/auth/github/callback
```

The login flow requests only `read:user user:email`. The repository connection requests `repo read:org`. The repository token is kept in the separate encrypted GitHub connection store and is the only GitHub credential used by repository reads and writes. Account identity is therefore not automatically treated as permission to read or modify repositories. Existing users should reconnect GitHub after deploying this change so their repository token is saved under the new repository flow.

## Model providers

Elias supports provider-backed model routing through the configured OpenAI-compatible providers. Add the relevant provider API keys to Vercel to make their live models available through `/api/models` and the Chat model picker. Auto mode preserves task-based routing; an explicit provider/model selection is carried into both Chat and autonomous task execution.

Supported provider environment variables include `QWEN_API_KEY`, `AGENTROUTER_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, and `GITHUB_TOKEN` where applicable.

## Vercel as an MCP connector

Elias does **not** use Vercel as an account sign-in provider. The previous `/api/connect/vercel` OAuth redirect has been removed because it sent users to `https://vercel.com/oauth/authorize` and incorrectly treated a service connector as end-user authentication.

The intended architecture is an MCP host/client connection. Elias’s server calls a configured Vercel MCP endpoint, discovers available tools, and invokes those tools only from authenticated server routes. The browser never receives the MCP credential and never redirects the user to a Vercel login screen.

Elias includes its own protected MCP endpoint at `/api/mcp/vercel`. Vercel authorization is now **per Elias account**: the signed-in user opens the Vercel connector detail screen, pastes that user’s Vercel API token, and Elias verifies it against `api.vercel.com` before storing it in the encrypted session. The token is never returned to the browser, never shared with another Elias user, and is removed when the user disconnects Vercel.

From Chat, the user opens **+ add** and chooses **Connect Vercel via MCP**. Elias opens the connector detail screen, shows the three available read-only tools, and asks for authorization only if that Elias account is not connected. A second Elias user must authorize a separate Vercel account or token; the first user’s connection is not reused. The `oac_...` client ID is not used by this flow.

## User flow

A new user visits Elias and is sent to `/login`. **Continue with GitHub** creates the Elias session from the GitHub identity. The workbench then starts empty: no sample conversations, projects, tasks, or connected services are shown.

From Chat, the user opens **+ add** and chooses **Connect GitHub** or **Connect Vercel via MCP**. GitHub remains a user-granted repository connector. Vercel is handled through the server-side MCP bridge and is not a second Elias login. Project screens should display real resources only after the relevant connector has been validated.

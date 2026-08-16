# Elias account and connector setup

Elias now uses GitHub OAuth for account creation and sign-in. GitHub repository access and Vercel access are separate connector permissions started from the Chat **+ add** menu.

## Required environment variables

Configure these values in the local `.env.local` file and in the Vercel project environment settings. Do not commit secrets.

```text
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
VERCEL_CLIENT_ID=...
VERCEL_CLIENT_SECRET=...
ELIAS_SESSION_SECRET=use-a-long-random-value-at-least-32-characters
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

## Vercel OAuth integration

Create a Vercel OAuth integration in the Vercel Integration Console. Register this redirect URL:

```text
https://YOUR-ELIAS-DOMAIN/api/connect/vercel/callback
```

Set the integration scopes to the minimum required for the first release: `user`, `project`, `deployment`, and `team`. Vercel exchanges the short-lived authorization code through `POST https://api.vercel.com/v2/oauth/access_token`. The access token is used only on the server side.

## User flow

A new user visits Elias and is sent to `/login`. **Continue with GitHub** creates the Elias session from the GitHub identity. The workbench then starts empty: no sample conversations, projects, tasks, or connected services are shown.

From Chat, the user opens **+ add** and chooses **Connect GitHub** or **Connect Vercel**. Elias sends the user to the corresponding consent page, validates the callback state, exchanges the code server-side, and records the resulting connection in the authenticated session. Project screens should display real resources only after the relevant connector has been authorized.

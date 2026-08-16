# Vercel OAuth troubleshooting notes

Source: https://vercel.com/docs/sign-in-with-vercel/troubleshooting

Vercel shows an error page when critical OAuth parameters are missing or invalid. An invalid or non-existent `client_id` produces the message that the app ID is invalid; the fix is to use the client ID shown on the integration’s Manage page. A missing or mismatched `redirect_uri` also produces an error; the callback URL must be registered in the integration’s Authorization Callback URLs. The authorization request must include `response_type=code`. If PKCE is used, `code_challenge` must be 43–128 characters and `code_challenge_method=S256`. The `prompt` parameter may be omitted or set to `consent` or `login`. Vercel also documents that team access restrictions can cause `access_denied`; the integration’s Sign-In Access setting may need to be set to Anyone with a Vercel account.

The current Elias route uses `https://vercel.com/oauth/authorize`, passes `client_id`, an origin-derived callback, `scope`, and `state`, but does not validate the client ID’s shape or provide a user-facing callback error page. The current `vercelConfigured()` only checks that the environment variables are non-empty. The likely immediate cause of the screenshot is that `VERCEL_CLIENT_ID` is empty, copied from the wrong Vercel page, or not the ID shown in the integration’s Manage page.

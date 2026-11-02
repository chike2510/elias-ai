# Elias browser runner (Cloudflare Worker)

Drives long browser jobs (`browser_task`) in a Durable Object holding one Cloudflare Browser Run session per run.
It only drives the browser: each step posts the screenshot + numbered elements to
`/api/browser/runs/<id>/step` on Elias, which picks the next action and applies the safety rails.

## Deploy

```bash
cd worker/browser-run
npm install
npx wrangler secret put ELIAS_WORKER_SECRET   # same value as ELIAS_WORKER_SECRET on Vercel
npx wrangler deploy
```

Needs a Cloudflare API token with Workers Scripts: Edit, Browser Rendering (Browser Run): Edit and Account Settings: Read
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

Then on Vercel set `ELIAS_WORKER_SECRET` and `ELIAS_BROWSER_WORKER_URL` (the `*.workers.dev` URL) and redeploy.
Without them, Elias runs short jobs in a Node runner inside the request's time budget.

Limits: one alarm runs up to ~14 minutes (including time spent waiting for approvals), 30 steps per run.

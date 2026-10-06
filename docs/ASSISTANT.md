# Elias assistant (`/assistant`)

A Hark-style personal assistant built on one tool-calling loop.

## How a turn works

1. `POST /api/assistant/chat` → `runTurn` (`lib/assistant/agent.ts`).
2. Loads the last 30 messages of the conversation (Postgres), the memory block (core profile/preference/person facts + full-text matches for this message), and connection status.
3. Calls the model with OpenAI-style `tools` (`lib/assistant/llm.ts`), falling back across providers (`ELIAS_AGENT_PROVIDERS`). Up to 10 tool steps.
4. Tools live in `lib/assistant/tools.ts`. A tool with `needsApproval` is not executed: an `elias_approvals` row is created and the user gets an Approve/Decline card.
5. After the reply, a cheap model call extracts durable facts into memory (`extractMemories`).
6. `POST /api/assistant/approvals/:id` executes (or declines) the stored call, records the result in the conversation, and lets Elias follow up.

## Tools

| Area | Tools | Approval |
|---|---|---|
| Time/web | get_time, web_search, web_open | – |
| Memory | memory_save, memory_search, memory_update, memory_forget | – |
| Gmail | gmail_search, gmail_read, gmail_draft, gmail_send | send |
| Calendar | calendar_list, calendar_create, calendar_delete | create with attendees, delete |
| Schedules | schedule_create, schedule_list, schedule_update | – |
| Browser | browser_open, browser_snapshot, browser_click, browser_type, browser_select, browser_close | final clicks (pay/order/book/send), detected by flag or button text |
| GitHub | github_api (GET) | – |

## Storage (Supabase Postgres, created automatically)

`elias_conversations`, `elias_messages`, `elias_memories` (tsvector full-text), `elias_oauth_tokens` (AES-GCM encrypted), `elias_schedules`, `elias_approvals`, `elias_assistant_browsers`.

## Scheduler

`/api/cron/tick` (Bearer `CRON_SECRET`) claims due schedules with `for update skip locked`, runs each as a turn with origin `schedule`, and posts the reply into the schedule's conversation. Supabase `pg_cron` + `pg_net` calls it every 5 minutes:

```sql
select cron.schedule('elias-tick', '*/5 * * * *', $$
  select net.http_post(url := 'https://<domain>/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'), timeout_milliseconds := 290000);
$$);
```

`vercel.json` also has a daily Vercel Cron as a backup (Hobby plans allow daily only).

## Setup checklist

- `POSTGRES_URL` (already provided by the Supabase integration).
- A tool-capable model: `HF_TOKEN` (default), `GROQ_API_KEY`, `MISTRAL_API_KEY`, or `ELIAS_AGENT_BASE_URL` + key for any OpenAI-compatible API.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for Gmail + Calendar (redirect URI `/api/connect/google/callback`). While the Google app is in "Testing", add your Google account as a test user.
- `CRON_SECRET` + the pg_cron job for schedules.
- `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` for real browser actions.

## Testing

`scripts/test-assistant.ts` runs the core end to end against Postgres and a scripted OpenAI-compatible mock (see header of the file).

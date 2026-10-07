# Elias assistant (`/assistant`)

A Hark-style personal assistant built on one tool-calling loop.

## How a turn works

1. `POST /api/assistant/chat` → `runTurn` (`lib/assistant/agent.ts`).
2. Loads the last 30 messages of the conversation (Postgres), the memory block (core profile/preference/person facts + full-text matches for this message), and connection status.
3. Calls the model with OpenAI-style `tools` (`lib/assistant/llm.ts`), falling back across providers (`ELIAS_AGENT_PROVIDERS`). Up to 10 tool steps.
4. Tools live in `lib/assistant/tools.ts`. A tool with `needsApproval` is not executed: an `elias_approvals` row is created and the user gets an Approve/Decline card.
5. After the reply, a cheap model call extracts durable facts into memory (`extractMemories`).
6. `POST /api/assistant/approvals/:id` executes (or declines) the stored call, records the result in the conversation, and lets Elias follow up.

## Chat input (v3): attachments, voice, model picker

**Attachments.** The paperclip in the composer offers *Take a photo*, *Photos and files* and the *Model* picker. Up to 4 images and 4 files per message, 10 MB each. Paste and drag-and-drop work too.
- Images are downscaled in the browser to ~1600px JPEG (`lib/chatMedia.ts`, re-encoded at 1280px if still large) and sent as base64 data URLs; the server passes them to the model as OpenAI `image_url` content parts. A ~192px thumbnail is stored on the message (`meta.attachments`) for history; full-size images are never stored.
- Documents (PDF, DOCX, XLSX/XLS/CSV, TXT/MD/JSON/HTML and other text) are uploaded to `POST /api/assistant/attachments` as raw bytes and extracted with `extractDocumentText` (`lib/documentPipeline.ts`: pdf-parse, mammoth, xlsx). Files over ~3 MB go in parts (Vercel caps request bodies at 4.5 MB); earlier parts wait in `elias_upload_parts` and are deleted when the last part arrives (or after an hour). The extracted text rides along in the chat request and is injected into the user turn (24k chars per file, 48k total). Up to 24k chars are kept on the message so the last three user turns keep their document context.
- Validation lives in `lib/assistant/modelRouter.ts` (`sanitizeAttachments`).

**Voice.** The mic button shows when the composer is empty. Hold to talk and release to send, or tap to start and tap again to stop (the transcript fills the composer for editing). Recording uses `MediaRecorder` (webm/opus, mp4 on Safari), stops at 2 minutes, and goes to `POST /api/assistant/transcribe` → Groq `whisper-large-v3-turbo`, falling back to `whisper-large-v3` (`GROQ_WHISPER_MODEL` overrides). Each assistant reply has a **Read aloud** button (browser `speechSynthesis`, free).

**Models and the router** (`lib/assistant/llm.ts` + `modelRouter.ts`).
- Providers, in order: custom, groq, **gemini** (when `GEMINI_API_KEY` is set; OpenAI-compatible base `https://generativelanguage.googleapis.com/v1beta/openai`; candidates gemini-3.8-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.0-flash, filtered by `/models`), cerebras, github, openrouter, mistral, huggingface, qwen.
- Tiers: **fast** (Groq llama-3.1-8b-instant / gpt-oss-20b, Cerebras, Gemini flash-lite first), **strong** (the normal lists: gpt-oss-120b, Gemini flash, GPT-4.1…), **vision** (Groq Llama 4 Maverick/Scout → GitHub gpt-4.1-mini → OpenRouter free vision models → Gemini). Each tier remembers its own working model per provider.
- Auto: images → vision; documents, a tool call earlier in the turn, messages over 400 chars, code, or words that usually need tools (email, calendar, remind, search, book, URLs…) → strong; everything else → fast.
- Picker: Auto (default), Fast, Strong, or any configured `provider/model` from `GET /api/assistant/models` (`?only=choice` returns just the saved choice). `PUT /api/assistant/models { model }` saves it in `elias_user_settings.data.model`; the chat also sends it per request (`model` in the body). A pinned model is tried first, then the tier's normal fallback, so chat still answers if it's down. Images always go to a vision model.
- Each reply stores `meta.model` (`provider/model`) and `meta.tier`; the UI shows a muted "via groq · gpt-oss-120b".
- Per-tier env overrides: `GROQ_FAST_MODEL`, `CEREBRAS_FAST_MODEL`, `GEMINI_FAST_MODEL`, `GITHUB_FAST_MODEL`, `MISTRAL_FAST_MODEL`, `GROQ_VISION_MODEL`, `GITHUB_VISION_MODEL`, `OPENROUTER_VISION_MODEL`, `GEMINI_VISION_MODEL`, `GEMINI_AGENT_MODEL`, and for the custom endpoint `ELIAS_AGENT_FAST_MODEL` / `ELIAS_AGENT_VISION_MODEL`.

**Health check.** `GET /api/assistant/health` (Bearer `ELIAS_HEALTH_TOKEN`) accepts `?provider=gemini` (try only that provider), `?model=<id>` (pin a model) and `?tier=fast|strong|vision` (vision sends a small red test image).

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
| Background | start_background_job, background_jobs | – (the job's own tool calls keep their approval gates) |

## Storage (Supabase Postgres, created automatically)

`elias_conversations`, `elias_messages`, `elias_memories` (tsvector full-text), `elias_oauth_tokens` (AES-GCM encrypted), `elias_schedules`, `elias_approvals`, `elias_assistant_browsers`, `elias_user_settings` (timezone, `data` JSON: city, `notify` prefs, `preferredName`, `onboardedAt`), `elias_push_subscriptions`, `elias_jobs`. The v3 tables live in `lib/assistant/schemaBackground.ts` and are created by `ready()`.

## Scheduler

`/api/cron/tick` (Bearer `CRON_SECRET`) claims due schedules with `for update skip locked`, runs each as a turn with origin `schedule`, and posts the reply into the schedule's conversation. Supabase `pg_cron` + `pg_net` calls it every 5 minutes:

```sql
select cron.schedule('elias-tick', '*/5 * * * *', $$
  select net.http_post(url := 'https://<domain>/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'), timeout_milliseconds := 290000);
$$);
```

`vercel.json` also has a daily Vercel Cron as a backup (Hobby plans allow daily only).

## Background jobs (`lib/assistant/jobs.ts`)

Long work the user hands off ("research this in the background", the **New job** button in Tasks, or the agent calling `start_background_job`).

- A row in `elias_jobs`: `status` (queued → running → waiting_approval / done / failed / cancelled), `steps` (one entry per slice), `result`, the chat it reports to (`conversation_id`) and a hidden work conversation (`work_conversation_id`, kind `job`, left out of the history list but openable from Tasks → "See the work").
- It runs in **slices**: each slice is one agent turn with at most 5 tool steps, ending in `STATUS: CONTINUE` + notes or `STATUS: DONE` + the result. Research jobs get up to 5 slices, tasks up to 6; the last slice must answer. At most 3 active jobs per user.
- **Lease**: `claimJobs` sets `lease_owner` + `lease_until` (270s) with `for update skip locked`, so two ticks never run the same job. A slice that dies leaves an expired lease and is reclaimed; a job reclaimed too often, or failing twice, is marked failed.
- **Driving it**: right after creation (and after each slice that wants more) a fire-and-forget `POST /api/cron/jobs` (Bearer `CRON_SECRET`) answers 202 and runs the next slice with `after()` in its own 300s budget. `/api/cron/tick` also kicks runnable jobs every 5 minutes (or runs one slice inline if the self-call can't be made). The self-call URL is `ELIAS_PUBLIC_URL`, else `VERCEL_PROJECT_PRODUCTION_URL`.
- **Approvals**: a slice that hits an approval-gated tool sets `waiting_approval` and pushes an "Approval needed" notification linking to the work conversation. Deciding it (`POST /api/assistant/approvals/:id`) re-queues the job once nothing else is pending.
- **Done**: the result is posted into the original chat ("Background job done: …") and a "jobs" push is sent. Cancel (`DELETE /api/assistant/jobs/:id`) stops it; a slice in flight is discarded.
- API: `GET/POST /api/assistant/jobs`, `GET/DELETE /api/assistant/jobs/:id`.

## Push notifications (`lib/assistant/push.ts`, `lib/pushClient.ts`, `public/sw.js`)

- Web Push with VAPID (`web-push`). Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:). The client fetches the public key from `GET /api/assistant/push`, so no `NEXT_PUBLIC_` var is needed.
- `POST /api/assistant/push {subscription}` saves a device, `DELETE {endpoint}` removes it, `PATCH {prefs}` sets per-type toggles, `POST {test:true}` sends a test.
- Types: `brief` (daily brief posted), `reminders` (any other scheduled task), `approvals` (an approval left by a schedule or a job; approvals raised in a live chat don't push, the user is looking at them), `jobs` (job finished or failed). All default on; toggles live on the You page.
- `notifyUser` never throws. 404/410 responses delete the subscription; other failures are counted and the device is dropped after 5.
- The service worker shows the notification, posts `elias:push` to open tabs (the chat refreshes quietly), and on click focuses/navigates an open tab to the conversation or opens a new window.
- Permission is only requested from a tap: the in-app card (after a turn that scheduled something or started a job, and in Tasks while a job runs), onboarding, or You → Notifications. iOS only supports Web Push for Home Screen apps (16.4+), so there the UI shows an "Add to Home Screen" hint instead.

## Onboarding (`/welcome`, `lib/assistant/onboarding.ts`)

First run (redirected from chat when `data.onboardedAt` and `data.onboardingSkippedAt` are both empty), skippable, redo from You → "Redo setup". Steps: what to call you (saved as a profile memory), timezone (auto-detected) + brief time + weather city (updates or creates the daily brief), connect Google (shows "Not configured yet" without `GOOGLE_CLIENT_ID`) and notifications, then four tap-to-answer preference questions plus an optional note, each saved as a preference memory. API: `GET/POST /api/assistant/onboarding` with `action` = profile | routine | preferences | complete | skip | reset.

## Setup checklist

- `POSTGRES_URL` (already provided by the Supabase integration).
- A tool-capable model: `HF_TOKEN` (default), `GROQ_API_KEY`, `MISTRAL_API_KEY`, or `ELIAS_AGENT_BASE_URL` + key for any OpenAI-compatible API.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for Gmail + Calendar (redirect URI `/api/connect/google/callback`). While the Google app is in "Testing", add your Google account as a test user.
- `CRON_SECRET` + the pg_cron job for schedules.
- `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` for real browser actions.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` for push (generate with `npx web-push generate-vapid-keys`).
- Optional `ELIAS_PUBLIC_URL` if job self-calls should target a custom domain.

## Testing

`scripts/test-assistant.ts` runs the core end to end against Postgres and a scripted OpenAI-compatible mock (see header of the file). The mock rejects image parts unless the model name contains "vision", which exercises the vision fallback; the test covers the fast/strong/vision tiers, a pinned model override, stored attachment metadata and document context. `tests/chat-input-v3.test.mjs` unit-tests the router and attachment validation. It covers jobs (slices, lease exclusivity, approval pause/resume, cancel, lease expiry, failure, limits), the push send path (with `setPushSender` mocking the network: 410 pruning, muted types, brief push) and onboarding. `tests/push-service-worker.test.mjs` checks the service worker's push and click handlers.

# Text-to-video integration

ELIAS now has an **application-side async text-to-video path**. It does not ship a video model or assume Hugging Face Inference Providers serves any particular checkpoint. Until a compatible worker is configured, the UI can show video mode but submissions return a clear `VIDEO_PROVIDER_UNAVAILABLE` response.

## Required server configuration

Set these server-side variables in the target deployment; do not expose them to browser code:

| Variable | Required | Meaning |
| --- | --- | --- |
| `ELIAS_VIDEO_API_URL` | Yes | HTTPS base URL of a compatible worker, for example `https://video-worker.example/v1`. Do not include credentials, query parameters, or a fragment. HTTP is accepted only for localhost during non-production development. |
| `ELIAS_VIDEO_API_TOKEN` | No | Bearer token sent only to the configured worker. |
| `ELIAS_VIDEO_MODEL` | No | Worker-specific model identifier passed through unchanged. |

The application does not install, launch, or provision GPU compute. No environment variables are changed by this PR.

## Worker contract

The worker owns queueing, model/runtime/license checks, GPU scheduling, provider-side safety enforcement, and cleanup. It must implement:

1. `POST {base}/jobs` — JSON request:
   ```json
   {
     "prompt": "A short cinematic shot of a fictional adult explorer walking through a fern forest",
     "duration_seconds": 4,
     "width": 512,
     "height": 512,
     "model": "optional configured model ID",
     "safety": {
       "mode": "fictional_adults_only",
       "require_human_characters_adult": true,
       "allow_image_to_video": false
     }
   }
   ```
   Return JSON such as `{"job_id":"job-123","status":"queued","progress":0}`. `status` is `queued`, `running`, `completed`, or `failed`.
2. `GET {base}/jobs/{job_id}` — return JSON with the same status vocabulary, optional integer `progress` from 0–100, and an optional short `error` for terminal failure.
3. `GET {base}/jobs/{job_id}/artifact` — after completion, return the MP4 bytes with `Content-Type: video/mp4`. The response must be a valid MP4 and no larger than 16 MiB. The app streams and bounds the response before storing it.

The app polls when an owner requests job status (Studio polls while open; reopening its task link resumes polling). Redirects from the configured worker URL are rejected. Polling is not a promise of background execution by the web app: the external worker must continue a submitted job independently of the browser. The application makes no provider callback or cancellation assumption. Each worker call has a bounded timeout, and jobs expire from ELIAS status after 20 minutes. MP4 finalization uses a database claim to avoid duplicate downloads/events during concurrent polls; an abandoned claim is recoverable after its 60-second lease.

## Storage and Library behavior

Task metadata and owner identity are stored with the existing task record. MP4 bytes are stored separately: in `public.elias_task_artifact_blobs` when `POSTGRES_URL` is configured, or under `.elias/artifact-blobs/` for local development. The table is created lazily by the task store. Artifact downloads require the owning ELIAS session; MP4 bytes are not embedded in task JSON responses. When a completed Studio job is polled, the browser copies the MP4 into its existing IndexedDB Library. Opening the Library also backfills up to 10 newest completed, not-yet-imported video artifacts per visit; opening a task remains a direct download fallback. These client-side copies can still be limited by browser quota, in which case the owner-scoped task artifact remains available.

For Vercel, the app already requires durable `POSTGRES_URL` for task records. Configure that store before enabling a worker, then deploy the database schema/runtime change as part of normal app deployment. The MP4 limit is 16 MiB in both server storage and Library handoff; browser quota can still prevent a local Library copy, in which case the owner-scoped task artifact remains available.

## Bounds and safety

- Text-to-video only; image-to-video input fields are rejected.
- Prompt: 2,000 characters maximum; duration: 1–4 seconds; resolution: each dimension at most 512, with a 262,144-pixel cap.
- Provider requests time out after 10 seconds; artifact downloads time out after 30 seconds; one job expires after 20 minutes; at most two retries per task.
- Every submission requires confirmation that any people shown are fictional adults (18+). Human-subject prompts must also say they are fictional adults; obvious youth-coded prompts and real-person / public-figure / likeness targeting terms are rejected. No identity-based sexual generation is supported.
- These prompt checks are **heuristics, not reliable moderation**. They can miss disguised or indirect references and cannot determine a person's actual age or identity. The worker must apply its own enforceable content/identity policy; do not treat ELIAS prompt checks as proof that generated output is safe or compliant. This text-only feature does not accept image references, uploads, or image-to-video inputs.

## Provider and cost caveat

The model candidates previously discussed do not establish a live inference endpoint for this application. In particular, a Hub model card or downloadable checkpoint is not the same as a hosted inference API. A compatible endpoint, its authorization, model compatibility, runtime license review, capacity, and per-job pricing must be selected and configured separately. This PR neither generates a sample nor submits a real job; all automated coverage uses mocked worker responses and synthetic MP4 bytes.

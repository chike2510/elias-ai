# ELIAS automations

ELIAS automations turn an incoming event into a normal ELIAS task. The task uses the configured model gateway to read context, decide what to do, draft a result, pause for approval when required, and record evidence and artifacts.

## Experiential Labs model gateway

ELIAS supports [Experiential Labs](https://platform.experientiallabs.ai/models) as an OpenAI-compatible provider. Set these server-only Vercel variables:

```text
EXPERIENTIAL_API_KEY=xpl_...
EXPERIENTIAL_BASE_URL=https://api.experientiallabs.ai/v1
EXPERIENTIAL_MODEL=qwen3.8-27b
```

`EXPLABS_API_KEY` is accepted as an alias for `EXPERIENTIAL_API_KEY`. ELIAS discovers the live catalog through `/v1/models`, selects a compatible model, and sends standard Chat Completions requests to `/v1/chat/completions`. If the provider is unavailable, the existing configured-provider fallback chain remains available.

Experiential Labs describes its gateway as OpenAI-compatible and supports platform-funded models, provider waterfalls, and the Responses API. ELIAS currently uses the Chat Completions-compatible path because it fits the existing provider router and task-agent contract.

## Create an automation

Open **Automations** in ELIAS and define:

- a name and objective;
- instructions for the agent;
- a manual or webhook trigger;
- allowed context and tools;
- an approval policy.

The recommended starting policy is **Approve risky actions**. Use **Always approve** while testing a new workflow. Use **Pre-approved** only for trusted, reversible automations.

A webhook automation returns a URL and a secret once at creation time. Store the secret in the external event source. ELIAS stores only a SHA-256 hash of the secret.

## Trigger a webhook automation

Send a JSON event using either the `Authorization` header or `x-elias-automation-secret`:

```bash
curl -X POST "https://YOUR-ELIAS-DOMAIN/api/automations/AUTOMATION_ID/trigger" \
  -H "Authorization: Bearer ela_..." \
  -H "Content-Type: application/json" \
  -d '{
    "source": "support-inbox",
    "event": {
      "subject": "New support request",
      "body": "A customer needs help with their account."
    }
  }'
```

The endpoint returns `202` with a `taskId`. The created task appears in the normal ELIAS Tasks view and follows the existing task lifecycle: plan, evidence, approval, tool execution, validation, and artifact delivery.

Incoming event payloads are treated as untrusted context. They are inserted into the task objective as data and must not override ELIAS safety instructions.

## Storage requirements

On Vercel, configure `POSTGRES_URL`. ELIAS uses it for tasks and automation definitions. Without durable storage, the local file adapter works only in trusted local development; Vercel rejects the configuration rather than silently losing definitions between function instances.

## Current integration boundary

The first automation release provides a generic webhook boundary so email providers, form systems, support inboxes, and other event sources can connect without hard-coding one vendor. The current tool policy exposes context and draft capabilities; sending email, changing a sheet, committing code, or performing another irreversible external side effect remains approval-gated and should be connected through a dedicated connector before enabling it in production.

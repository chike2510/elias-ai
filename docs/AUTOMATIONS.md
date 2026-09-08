# ELIAS automations

ELIAS automations turn an incoming event into a normal ELIAS task. The task uses the configured model gateway to read context, decide what to do, draft a result, pause for approval when required, and record evidence and artifacts.

## Experiential Labs model gateway

ELIAS supports [Experiential Labs](https://platform.experientiallabs.ai/models) as an OpenAI-compatible provider. Set these server-only Vercel variables:

```text
EXPLABS_API_KEY=xpl_...
# Optional aliases/overrides:
EXPERIENTIAL_API_KEY=
EXPERIENTIAL_BASE_URL=https://api.experientiallabs.ai
EXPERIENTIAL_MODEL=
```

`EXPLABS_API_KEY` is the canonical key name; `EXPERIENTIAL_API_KEY` is accepted as a compatibility alias. **Do not enter a model name unless you want to pin one.** When `EXPERIENTIAL_MODEL` is blank, ELIAS calls `/v1/models`, loads the live catalog, ranks the available models for the task, and selects one automatically. The base URL may be supplied with or without `/v1`; ELIAS normalizes it.

ELIAS calls `/v1/chat/completions` first and can retry the same Experiential model through `/v1/responses` when the model route requires the Responses wire format. If the gateway is unavailable, the existing configured-provider fallback chain remains available and the models endpoint exposes provider diagnostics rather than silently presenting invented model IDs.

Experiential Labs documents its gateway as OpenAI-compatible, with platform-funded models, provider waterfalls, live catalog discovery, and multiple API wire formats.

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

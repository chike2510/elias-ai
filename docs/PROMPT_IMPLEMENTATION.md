# ELIAS Prompt Implementation Checklist

## Task 1 — Document generation

**Shipped.** `lib/artifacts.ts` now uses `pdf-lib`, `docx`, and `pptxgenjs`. PDF output paginates instead of truncating, DOCX output supports headings and ordered/unordered lists, and PPTX output creates multiple slides for long content.

## Task 2 — Code and text export

**Shipped.** Code and Markdown artifacts pass through a lightweight Prettier formatting step. Markdown is parsed with `remark-parse` before delivery. Artifact cards display exact file labels such as `TSX`, `MD`, `PDF`, and `PPTX`.

## Task 3 — Media generation

**Partially shipped.** `lib/generationProviders.ts` provides submit/poll job semantics, and `/api/generation` submits an image task through Pollinations, polls it, fetches the completed image, and stores it in the existing task artifact pipeline. Studio exposes the image-generation form and links to the completed task.

Video generation and text-to-speech are **explicitly deferred** until a hosted or self-hosted video/TTS provider is configured. Studio presents these as capability cards instead of pretending they are available.

## Task 4 — Gradient backdrop

**Shipped.** `components/GradientBackdrop.tsx` implements reusable CSS-blurred brand-color circles with adjustable intensity. It is applied to the task-start empty state and can be reused by other surfaces through the `intensity` and `colors` props.

## Task 5 — UI/UX refinements

| Requirement | Status |
|---|---|
| Per-surface accent colors | Shipped through route-derived shell surface classes and accent rails. |
| Task progress stepper | Shipped; the task workbench already uses the pipeline tracker and now retains it alongside the progress meter. |
| Provider-fallback micro-status | Shipped; chat reports the provider(s) that failed before the successful retry. |
| Interruption-safe approvals | Shipped; task history now shows `Approval needed` for tasks with pending approvals after reopening. |
| Mobile task workbench bottom tab switcher | Deferred; the current StepTracker and vertically stacked task panels remain accessible, but a single-focus bottom navigator needs a larger interaction redesign. |
| Intentional empty/error states | Shipped for Studio generation capabilities and task-start empty state; unsupported video/TTS are explained rather than shown as dead controls. |

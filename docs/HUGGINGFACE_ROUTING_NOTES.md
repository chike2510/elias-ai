# Hugging Face routing references

Verified 2026-09-28 from official Hugging Face documentation:

- Inference Providers overview: https://huggingface.co/docs/inference-providers/en/index
  - Requires a fine-grained HF token with `Make calls to Inference Providers` permission.
  - OpenAI-compatible router base URL: `https://router.huggingface.co/v1`.
  - Model routing policies can use `:fastest`, `:cheapest`, `:preferred`, or a provider suffix.
- Text-to-image task: https://huggingface.co/docs/inference-providers/en/tasks/text-to-image
  - Recommended models include `Qwen/Qwen-Image`, `black-forest-labs/FLUX.1-Krea-dev`, and `ByteDance/Hyper-SD`.
  - Task request accepts `inputs` and parameters such as width/height; response is raw image bytes.
- Task index: https://huggingface.co/docs/inference-providers/en/tasks/index
  - Lists chat completion, text-to-image, text-to-video, audio classification, speech recognition, and other task families.

Implementation implication: ELIAS must not send image prompts to `/chat/completions` on a Qwen chat endpoint. It needs a capability-aware media adapter that calls the text-to-image task endpoint and stores binary output as an artifact; chat/coding and automation planning should remain on text/tool-capable models.

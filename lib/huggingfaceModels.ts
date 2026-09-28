export type HuggingFaceModelCapability = "chat" | "code" | "image-generation" | "speech-to-text" | "text-to-video";

export type HuggingFaceModelDefinition = {
  id: string;
  label: string;
  capability: HuggingFaceModelCapability;
  enabled: boolean;
  notes: string;
};

/**
 * Public model IDs belong in source control. Secrets never belong here.
 * Keep capability-specific models separate: a chat model is not an image model.
 */
export const HUGGINGFACE_MODELS: HuggingFaceModelDefinition[] = [
  {
    id: "Qwen/Qwen-Image",
    label: "Qwen Image",
    capability: "image-generation",
    enabled: true,
    notes: "Primary text-to-image model routed through Hugging Face Inference Providers.",
  },
  {
    id: "black-forest-labs/FLUX.1-Krea-dev",
    label: "FLUX Krea Dev",
    capability: "image-generation",
    enabled: true,
    notes: "Higher-quality alternative when the selected provider supports it.",
  },
  {
    id: "ByteDance/Hyper-SD",
    label: "Hyper-SD",
    capability: "image-generation",
    enabled: true,
    notes: "Fast image-generation alternative.",
  },
  {
    id: "openai/whisper-large-v3",
    label: "Whisper Large V3",
    capability: "speech-to-text",
    enabled: true,
    notes: "Reserved for the speech transcription adapter.",
  },
];

export function huggingFaceModel(capability: HuggingFaceModelCapability, override?: string) {
  return override || HUGGINGFACE_MODELS.find((model) => model.capability === capability && model.enabled)?.id;
}

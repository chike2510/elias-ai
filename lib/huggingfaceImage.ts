import type { InferenceClient } from "@huggingface/inference";

type TextToImageClient = Pick<InferenceClient, "textToImage">;

export async function requestHuggingFaceImage(
  client: TextToImageClient,
  input: { model: string; prompt: string; width: number; height: number; signal: AbortSignal },
): Promise<Blob> {
  try {
    return await client.textToImage(
      {
        provider: "auto",
        model: input.model,
        inputs: input.prompt,
        parameters: { width: input.width, height: input.height },
      },
      { outputType: "blob", signal: input.signal },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/no inference provider|inference provider information|not supported for task|not supported by provider/i.test(detail)) {
      throw new Error(
        `Hugging Face model ${input.model} is not currently available for text-to-image through its Inference Providers mapping. Choose a model with a live text-to-image provider mapping or update HF_IMAGE_MODEL.`,
        { cause: error },
      );
    }
    throw error;
  }
}

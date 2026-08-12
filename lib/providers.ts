import { ProviderConfig, ProviderName, TaskType } from "@/lib/types";

function env(name: string) {
  return process.env[name];
}

export function providerConfig(name: ProviderName): ProviderConfig {
  const map: Record<ProviderName, ProviderConfig> = {
    qwen: {
      name: "qwen",
      key: env("QWEN_API_KEY"),
      baseUrl: env("QWEN_BASE_URL"),
      model: env("QWEN_MODEL")
    },
    agentrouter: {
      name: "agentrouter",
      key: env("AGENTROUTER_API_KEY"),
      baseUrl: env("AGENTROUTER_BASE_URL"),
      model: env("AGENTROUTER_MODEL")
    },
    groq: {
      name: "groq",
      key: env("GROQ_API_KEY"),
      baseUrl: env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1",
      model: env("GROQ_MODEL")
    },
    openrouter: {
      name: "openrouter",
      key: env("OPENROUTER_API_KEY"),
      baseUrl: env("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1",
      model: env("OPENROUTER_MODEL")
    },
    cerebras: {
      name: "cerebras",
      key: env("CEREBRAS_API_KEY"),
      baseUrl: env("CEREBRAS_BASE_URL") || "https://api.cerebras.ai/v1",
      model: env("CEREBRAS_MODEL")
    },
    mistral: {
      name: "mistral",
      key: env("MISTRAL_API_KEY"),
      baseUrl: env("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1",
      model: env("MISTRAL_MODEL")
    },
    github: {
      name: "github",
      key: env("GITHUB_MODELS_TOKEN"),
      baseUrl: env("GITHUB_MODELS_BASE_URL") || "https://models.github.ai/inference",
      model: env("GITHUB_MODELS_MODEL")
    }
  };
  return map[name];
}

export function orderedProviders(task: TaskType): ProviderName[] {
  const special = task === "code"
    ? env("ELIAS_CODE_PROVIDER")
    : task === "research"
      ? env("ELIAS_RESEARCH_PROVIDER")
      : env("ELIAS_GENERAL_PROVIDER");

  const order = (env("ELIAS_PROVIDER_ORDER") || "qwen,openrouter,cerebras,groq,agentrouter,mistral,github")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean) as ProviderName[];

  const combined = special ? [special as ProviderName, ...order] : order;
  return [...new Set(combined)];
}

export function hasUsableConfig(name: ProviderName): boolean {
  const cfg = providerConfig(name);
  return Boolean(cfg.key && cfg.baseUrl && cfg.model);
}
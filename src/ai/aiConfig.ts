import type { AiProvider, AiProviderKind, AiOptions } from "../models/ai";

export const AI_PROVIDERS_KEY = "dssh.ai.providers";
export const AI_ACTIVE_PROVIDER_KEY = "dssh.ai.activeProvider";
export const AI_OPTIONS_KEY = "dssh.ai.options";

/** Fixed id of the singleton GitHub Copilot provider entry. */
export const COPILOT_PROVIDER_ID = "copilot";

/** Build the fixed Copilot provider entry. Auth is handled by the backend, so
 * baseUrl/apiKey stay empty; only the selected model and fetched list matter. */
export function createCopilotProvider(): AiProvider {
  return {
    id: COPILOT_PROVIDER_ID,
    label: "GitHub Copilot",
    baseUrl: "",
    apiKey: "",
    model: "",
    proxyUrl: "",
    models: [],
    kind: "copilot",
  };
}

/** Ensure the singleton Copilot entry is present, appended once at the end. */
export function ensureCopilotProvider(providers: AiProvider[]): AiProvider[] {
  if (providers.some((provider) => provider.kind === "copilot")) {
    return providers;
  }
  return [...providers, createCopilotProvider()];
}

export const DEFAULT_AI_OPTIONS: AiOptions = {
  requireApproval: true,
  temperature: null,
  maxSteps: 12,
  historyMaxChars: 16000,
  historyRecentChars: 8000,
  historyChunkChars: 3000,
};

/** Convenience endpoint presets shown when creating a provider. */
export interface EndpointPreset {
  id: string;
  label: string;
  baseUrl: string;
}

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1/" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1/" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/" },
  { id: "moonshot", label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1/" },
  { id: "dashscope", label: "阿里云百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/" },
  { id: "siliconflow", label: "SiliconFlow 硅基流动", baseUrl: "https://api.siliconflow.cn/v1/" },
  { id: "ollama", label: "Ollama (本地)", baseUrl: "http://localhost:11434/v1/" },
  { id: "lmstudio", label: "LM Studio (本地)", baseUrl: "http://localhost:1234/v1/" },
];

export function createProviderId(): string {
  return `ai-provider-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function createEmptyProvider(): AiProvider {
  return {
    id: createProviderId(),
    label: "新的模型后端",
    baseUrl: "https://api.openai.com/v1/",
    apiKey: "",
    model: "",
    proxyUrl: "",
    models: [],
    kind: "openai",
  };
}

export function loadProviders(): AiProvider[] {
  try {
    const raw = localStorage.getItem(AI_PROVIDERS_KEY);
    if (!raw) {
      return ensureCopilotProvider([]);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return ensureCopilotProvider([]);
    }
    const providers = parsed
      .filter((item): item is AiProvider => typeof item === "object" && item !== null)
      .map((item) => {
        const kind: AiProviderKind = item.kind === "copilot" ? "copilot" : "openai";
        return {
          id: String(item.id ?? createProviderId()),
          label: String(item.label ?? "模型后端"),
          baseUrl: String(item.baseUrl ?? ""),
          apiKey: String(item.apiKey ?? ""),
          model: String(item.model ?? ""),
          proxyUrl: String(item.proxyUrl ?? ""),
          models: Array.isArray(item.models)
            ? item.models.filter((model): model is string => typeof model === "string")
            : [],
          kind,
        };
      });
    return ensureCopilotProvider(providers);
  } catch {
    return ensureCopilotProvider([]);
  }
}

export function saveProviders(providers: AiProvider[]) {
  localStorage.setItem(AI_PROVIDERS_KEY, JSON.stringify(providers));
}

export function loadActiveProviderId(): string | null {
  return localStorage.getItem(AI_ACTIVE_PROVIDER_KEY);
}

export function saveActiveProviderId(id: string | null) {
  if (id) {
    localStorage.setItem(AI_ACTIVE_PROVIDER_KEY, id);
  } else {
    localStorage.removeItem(AI_ACTIVE_PROVIDER_KEY);
  }
}

export function loadOptions(): AiOptions {
  try {
    const raw = localStorage.getItem(AI_OPTIONS_KEY);
    if (!raw) {
      return { ...DEFAULT_AI_OPTIONS };
    }
    const parsed = JSON.parse(raw) as Partial<AiOptions>;
    const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(max, Math.max(min, Math.round(value)))
        : fallback;

    const historyMaxChars = clampInt(
      parsed.historyMaxChars,
      2000,
      200000,
      DEFAULT_AI_OPTIONS.historyMaxChars,
    );
    // The verbatim window must stay below the trigger threshold, otherwise
    // compaction would never actually drop anything.
    const historyRecentChars = Math.min(
      historyMaxChars - 1000,
      clampInt(parsed.historyRecentChars, 1000, 200000, DEFAULT_AI_OPTIONS.historyRecentChars),
    );

    return {
      requireApproval:
        typeof parsed.requireApproval === "boolean"
          ? parsed.requireApproval
          : DEFAULT_AI_OPTIONS.requireApproval,
      temperature:
        typeof parsed.temperature === "number" ? parsed.temperature : DEFAULT_AI_OPTIONS.temperature,
      maxSteps:
        typeof parsed.maxSteps === "number" && Number.isFinite(parsed.maxSteps)
          ? Math.min(40, Math.max(1, Math.round(parsed.maxSteps)))
          : DEFAULT_AI_OPTIONS.maxSteps,
      historyMaxChars,
      historyRecentChars: Math.max(1000, historyRecentChars),
      historyChunkChars: clampInt(
        parsed.historyChunkChars,
        500,
        20000,
        DEFAULT_AI_OPTIONS.historyChunkChars,
      ),
    };
  } catch {
    return { ...DEFAULT_AI_OPTIONS };
  }
}

export function saveOptions(options: AiOptions) {
  localStorage.setItem(AI_OPTIONS_KEY, JSON.stringify(options));
}

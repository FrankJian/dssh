import providerPresets from "./providerPresets.json" with { type: "json" };
import type { AiProvider, AiProviderKind, AiOptions, AiModelConfig, AiReasoningLevel } from "../models/ai";

export const AI_PROVIDERS_KEY = "dssh.ai.providers";
export const AI_ACTIVE_PROVIDER_KEY = "dssh.ai.activeProvider";
export const AI_OPTIONS_KEY = "dssh.ai.options";

export const DEFAULT_MODEL_CONTEXT_WINDOW = 256000;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 32000;
export const MIN_MODEL_CONTEXT_WINDOW = 4096;
export const MAX_MODEL_CONTEXT_WINDOW = 10000000;

export function parseTokenCapacity(value: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([km])?$/i.exec(value.trim());
  if (!match) return NaN;
  return Number(match[1]) * (match[2]?.toLowerCase() === "m" ? 1000000 : match[2] ? 1000 : 1);
}

export function formatTokenCapacity(value: number): string {
  return value % 1000 === 0 ? `${value / 1000}K` : String(value);
}

export const REASONING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

export function defaultReasoningLevels(): AiReasoningLevel[] {
  return ["off", "low", "medium", "high"].map((level) => ({ level, apiValue: level === "off" ? "" : level }));
}

export function normalizeReasoningLevels(value: unknown, legacyEffort?: unknown): AiReasoningLevel[] {
  const entries = Array.isArray(value) ? value : typeof legacyEffort === "string" && legacyEffort ? defaultReasoningLevels() : [];
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !REASONING_LEVEL_NAMES.some((name) => name === entry.level) || seen.has(entry.level)) return [];
    seen.add(entry.level);
    return [{ level: entry.level, apiValue: typeof entry.apiValue === "string" ? entry.apiValue : entry.level === "off" ? "" : entry.level }];
  });
}

/** Convert legacy ID lists without losing selected models or existing capacities. */
export function normalizeModels(value: unknown, selected = ""): AiModelConfig[] {
  const models: AiModelConfig[] = [];
  const seen = new Set<string>();
  const entries = [...(Array.isArray(value) ? value : [])];
  if (selected.trim() && !entries.some((m) => (typeof m === "string" ? m.trim() : typeof m?.id === "string" ? m.id.trim() : "") === selected.trim())) entries.unshift(selected.trim());
  for (const item of entries) {
    const entry = typeof item === "string" ? { id: item } : item;
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const contextWindow = Number.isInteger(entry.contextWindow) && entry.contextWindow >= MIN_MODEL_CONTEXT_WINDOW && entry.contextWindow <= MAX_MODEL_CONTEXT_WINDOW
      ? entry.contextWindow : DEFAULT_MODEL_CONTEXT_WINDOW;
    const reasoningLevels = normalizeReasoningLevels(entry.reasoningLevels, entry.reasoningEffort);
    const reasoningEffort = reasoningLevels.some((row) => row.level === entry.reasoningEffort) ? entry.reasoningEffort
      : reasoningLevels.find((row) => row.level === "medium")?.level ?? reasoningLevels[0]?.level ?? null;
    models.push({
      id,
      displayName: typeof entry.displayName === "string" && entry.displayName.trim() ? entry.displayName.trim() : id,
      contextWindow,
      maxOutputTokens: Number.isInteger(entry.maxOutputTokens) && entry.maxOutputTokens > 0 && entry.maxOutputTokens < contextWindow
        ? entry.maxOutputTokens : Math.min(DEFAULT_MODEL_MAX_OUTPUT_TOKENS, Math.floor(contextWindow / 4)),
      inputTypes: Array.isArray(entry.inputTypes) && entry.inputTypes.includes("image") ? ["text", "image"] : ["text"],
      reasoningEffort, reasoningLevels,
    });
  }
  return models;
}

export const DEFAULT_AI_OPTIONS: AiOptions = {
  requireApproval: true,
  temperature: null,
  maxSteps: 12,
};

export const API_PROTOCOLS: { value: AiProviderKind; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];

export interface EndpointPreset {
  id: string;
  label: string;
  baseUrl: string;
  kind: AiProviderKind;
  sourceUrl: string;
  verifiedOn: string;
  legacyBaseUrls?: string[];
}

export const ENDPOINT_PRESETS = providerPresets as EndpointPreset[];

export function inferPresetId(provider: Pick<AiProvider, "baseUrl" | "kind"> & { presetId?: string | null }): string {
  if (provider.presetId) return provider.presetId;
  const base = provider.baseUrl.trim().replace(/\/+$/, "");
  return ENDPOINT_PRESETS.find((preset) => preset.kind === provider.kind && [preset.baseUrl, ...(preset.legacyBaseUrls ?? [])]
    .some((url) => url.replace(/\/+$/, "") === base))?.id ?? "custom";
}

export function createEmptyProvider(preset?: EndpointPreset): AiProvider {
  return {
    id: `ai-provider-${crypto.randomUUID()}`,
    presetId: preset?.id ?? "custom",
    label: preset?.label ?? "自定义 API",
    baseUrl: preset?.baseUrl ?? "",
    model: "",
    proxyUrl: "",
    models: [],
    hasApiKey: false,
    kind: preset?.kind ?? "openai-completions",
  };
}

/** Only for one-time migration; remove legacy keys after Rust confirms all writes. */
export function loadLegacyProviders(): AiProvider[] {
  const raw = localStorage.getItem(AI_PROVIDERS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("旧版模型配置无法读取。");
  return parsed
    .filter((item) => item && typeof item === "object" && item.kind !== "copilot")
    .map((item) => ({
      id: String(item.id ?? `ai-provider-${crypto.randomUUID()}`),
      label: String(item.label ?? "模型服务"),
      baseUrl: String(item.baseUrl ?? ""),
      apiKey: String(item.apiKey ?? ""),
      hasApiKey: false,
      model: String(item.model ?? ""),
      proxyUrl: String(item.proxyUrl ?? ""),
      models: normalizeModels(item.models, String(item.model ?? "")),
      kind: API_PROTOCOLS.some((p) => p.value === item.kind) ? item.kind as AiProviderKind : "openai-completions" as const,
    }));
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

    };
  } catch {
    return { ...DEFAULT_AI_OPTIONS };
  }
}

export function saveOptions(options: AiOptions) {
  localStorage.setItem(AI_OPTIONS_KEY, JSON.stringify(options));
}

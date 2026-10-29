import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiOptions, AiProvider } from "../models/ai";
import { deleteAiProvider, loadAiProviders, saveAiProvider } from "../services/aiService";
import {
  AI_PROVIDERS_KEY, loadActiveProviderId, loadLegacyProviders,
  loadOptions, saveActiveProviderId, saveOptions,
} from "./aiConfig";

export interface AiConfig {
  providers: AiProvider[];
  activeProviderId: string | null;
  activeProvider: AiProvider | null;
  options: AiOptions;
  isConfigured: boolean;
  isReady: boolean;
  error: string | null;
  reload: () => void;
  saveProvider: (provider: AiProvider) => Promise<AiProvider>;
  removeProvider: (id: string) => Promise<void>;
  selectModel: (id: string, model: string) => void;
  setActiveProviderId: (id: string) => void;
  selectReasoningLevel: (id: string, model: string, level: string) => void;
  setOptions: (patch: Partial<AiOptions>) => void;
}

// Share bootstrap across React StrictMode's effect replay. Migration is idempotent;
// never overwrite a newer Rust descriptor with an old browser copy.
let bootstrap: Promise<AiProvider[]> | null = null;
function loadConfiguration() {
  if (!bootstrap) {
    bootstrap = (async () => {
      const stored = await loadAiProviders();
      for (const provider of loadLegacyProviders()) {
        if (!stored.some((item) => item.id === provider.id)) {
          stored.push(await saveAiProvider(provider));
        }
      }
      localStorage.removeItem(AI_PROVIDERS_KEY);
      return stored;
    })().catch((error: unknown) => { bootstrap = null; throw error; });
  }
  return bootstrap;
}

export function useAiConfig(): AiConfig {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(loadActiveProviderId);
  const [options, setOptionsState] = useState<AiOptions>(loadOptions);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void loadConfiguration().then((items) => {
      if (!cancelled) {
        let selected: Record<string, string> = {};
        try { selected = JSON.parse(localStorage.getItem("dssh.ai.selectedModels") ?? "{}"); } catch { /* Use saved defaults. */ }
        let reasoning: Record<string, string> = {};
        try { reasoning = JSON.parse(localStorage.getItem("dssh.ai.selectedReasoningLevels") ?? "{}"); } catch { /* Use saved defaults. */ }
        setProviders(items.map((p) => ({
          ...p,
          model: selected?.[p.id] && p.models.some((m) => m.id === selected[p.id]) ? selected[p.id] : p.model,
          models: p.models.map((model) => {
            const level = reasoning?.[JSON.stringify([p.id, model.id])];
            return model.reasoningLevels.some((row) => row.level === level) ? { ...model, reasoningEffort: level } : model;
          }),
        })));
        setIsReady(true);
      }
    }).catch(async (cause: unknown) => {
      // A damaged legacy entry must not hide usable backend configurations or
      // prevent adding a replacement. The original browser data stays intact.
      try {
        const stored = await loadAiProviders();
        if (!cancelled) { setProviders(stored); setIsReady(true); }
      } catch { /* Backend unavailable; leave the retry action visible. */ }
      if (!cancelled) setError(cause instanceof Error ? cause.message : "模型配置加载失败，旧版配置已保留。");
    });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => { if (isReady) saveActiveProviderId(activeProviderId); }, [activeProviderId, isReady]);
  useEffect(() => { saveOptions(options); }, [options]);
  useEffect(() => {
    if (isReady) localStorage.setItem("dssh.ai.selectedModels", JSON.stringify(Object.fromEntries(providers.map((p) => [p.id, p.model]))));
  }, [providers, isReady]);
  useEffect(() => {
    if (isReady && !providers.some((p) => p.id === activeProviderId)) {
      setActiveProviderId(providers[0]?.id ?? null);
    }
  }, [providers, activeProviderId, isReady]);

  const saveProvider = useCallback(async (provider: AiProvider) => {
    const saved = await saveAiProvider(provider);
    bootstrap = null;
    setProviders((previous) => previous.some((p) => p.id === saved.id)
      ? previous.map((p) => p.id === saved.id ? saved : p) : [...previous, saved]);
    setActiveProviderId((current) => current ?? saved.id);
    setError(null);
    return saved;
  }, []);

  const removeProvider = useCallback(async (id: string) => {
    await deleteAiProvider(id);
    bootstrap = null;
    setProviders((previous) => previous.filter((p) => p.id !== id));
  }, []);

  const selectModel = useCallback((id: string, model: string) => {
    // Requests carry the chosen model separately; switching doesn't need to wait
    // for a settings write, and never changes an already-running request.
    setProviders((previous) => previous.map((p) => p.id === id ? { ...p, model } : p));
    setActiveProviderId(id);
  }, []);

  const selectReasoningLevel = useCallback((id: string, modelId: string, level: string) => {
    setProviders((previous) => previous.map((provider) => provider.id === id ? {
      ...provider, models: provider.models.map((model) => model.id === modelId && model.reasoningLevels.some((row) => row.level === level)
        ? { ...model, reasoningEffort: level } : model),
    } : provider));
  }, []);
  useEffect(() => {
    if (isReady) localStorage.setItem("dssh.ai.selectedReasoningLevels", JSON.stringify(Object.fromEntries(providers.flatMap((provider) =>
      provider.models.filter((model) => model.reasoningEffort).map((model) => [JSON.stringify([provider.id, model.id]), model.reasoningEffort])))));
  }, [providers, isReady]);

  const setOptions = useCallback((patch: Partial<AiOptions>) => {
    setOptionsState((previous) => {
      const next = { ...previous, ...patch };
      return next;
    });
  }, []);
  const activeProvider = useMemo(() => providers.find((p) => p.id === activeProviderId) ?? null,
    [providers, activeProviderId]);

  return {
    providers, activeProviderId, activeProvider, options, isReady, error,
    isConfigured: isReady && Boolean(activeProvider?.model.trim() && activeProvider.baseUrl.trim()),
    reload: () => { bootstrap = null; setRevision((r) => r + 1); },
    saveProvider, removeProvider, selectModel, selectReasoningLevel, setActiveProviderId, setOptions,
  };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiOptions, AiProvider } from "../models/ai";
import { getCopilotStatus } from "../services/aiService";
import {
  COPILOT_PROVIDER_ID,
  DEFAULT_AI_OPTIONS,
  loadActiveProviderId,
  loadOptions,
  loadProviders,
  saveActiveProviderId,
  saveOptions,
  saveProviders,
} from "./aiConfig";

export interface AiConfig {
  providers: AiProvider[];
  activeProviderId: string | null;
  activeProvider: AiProvider | null;
  options: AiOptions;
  isConfigured: boolean;
  /** Whether the user is logged in to GitHub Copilot (backend-tracked). */
  copilotLoggedIn: boolean;
  refreshCopilotStatus: () => Promise<void>;
  addProvider: (provider: AiProvider) => void;
  updateProvider: (id: string, patch: Partial<AiProvider>) => void;
  removeProvider: (id: string) => void;
  setActiveProviderId: (id: string) => void;
  setOptions: (patch: Partial<AiOptions>) => void;
}

export function useAiConfig(): AiConfig {
  const [providers, setProviders] = useState<AiProvider[]>(() => loadProviders());
  const [activeProviderId, setActiveProviderIdState] = useState<string | null>(() =>
    loadActiveProviderId(),
  );
  const [options, setOptionsState] = useState<AiOptions>(() => loadOptions());
  const [copilotLoggedIn, setCopilotLoggedIn] = useState(false);

  const refreshCopilotStatus = useCallback(async () => {
    try {
      setCopilotLoggedIn(await getCopilotStatus());
    } catch {
      setCopilotLoggedIn(false);
    }
  }, []);

  useEffect(() => {
    void refreshCopilotStatus();
  }, [refreshCopilotStatus]);

  useEffect(() => {
    saveProviders(providers);
  }, [providers]);

  useEffect(() => {
    saveActiveProviderId(activeProviderId);
  }, [activeProviderId]);

  useEffect(() => {
    saveOptions(options);
  }, [options]);

  // Keep the active selection valid as providers are added/removed.
  useEffect(() => {
    if (providers.length === 0) {
      if (activeProviderId !== null) {
        setActiveProviderIdState(null);
      }
      return;
    }
    if (!activeProviderId || !providers.some((provider) => provider.id === activeProviderId)) {
      setActiveProviderIdState(providers[0].id);
    }
  }, [providers, activeProviderId]);

  const addProvider = useCallback((provider: AiProvider) => {
    setProviders((prev) => [...prev, provider]);
    setActiveProviderIdState(provider.id);
  }, []);

  const updateProvider = useCallback((id: string, patch: Partial<AiProvider>) => {
    setProviders((prev) =>
      prev.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)),
    );
  }, []);

  const removeProvider = useCallback((id: string) => {
    // The fixed Copilot entry can't be deleted.
    if (id === COPILOT_PROVIDER_ID) {
      return;
    }
    setProviders((prev) => prev.filter((provider) => provider.id !== id));
  }, []);

  const setActiveProviderId = useCallback((id: string) => {
    setActiveProviderIdState(id);
  }, []);

  const setOptions = useCallback((patch: Partial<AiOptions>) => {
    setOptionsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) ?? null,
    [providers, activeProviderId],
  );

  const isConfigured = Boolean(
    activeProvider &&
      activeProvider.model.trim() &&
      (activeProvider.kind === "copilot" ? copilotLoggedIn : activeProvider.baseUrl.trim()),
  );

  return {
    providers,
    activeProviderId,
    activeProvider,
    options: options ?? DEFAULT_AI_OPTIONS,
    isConfigured,
    copilotLoggedIn,
    refreshCopilotStatus,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProviderId,
    setOptions,
  };
}

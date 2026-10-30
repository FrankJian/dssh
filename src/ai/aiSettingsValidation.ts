import type { AiModelConfig, AiProvider } from "../models/ai";
import { MIN_MODEL_CONTEXT_WINDOW, MAX_MODEL_CONTEXT_WINDOW } from "./aiConfig.ts";

export function settingsActionError(provider: AiProvider, testConnection = false): string | null {
  if (!provider.label.trim()) return "请填写服务显示名称。";
  if (!provider.baseUrl.trim()) return "请填写 API 地址。";
  if (testConnection && !provider.model.trim()) return "请先填写模型 ID，再测试连接。";
  return null;
}

export function resolveModelCatalog(models: AiModelConfig[], defaultModel: string, editingId: string | null, entry: AiModelConfig) {
  if (!entry.id) throw new Error("请填写模型 ID。");
  if (models.some((model) => model.id === entry.id && model.id !== editingId)) {
    throw new Error("此模型 ID 已添加，可在列表中编辑。");
  }
  if (!Number.isInteger(entry.contextWindow) || entry.contextWindow < MIN_MODEL_CONTEXT_WINDOW || entry.contextWindow > MAX_MODEL_CONTEXT_WINDOW) {
    throw new Error("上下文窗口须为 4096 到 10000000 之间的整数。");
  }
  if (!Number.isInteger(entry.maxOutputTokens) || entry.maxOutputTokens < 1 || entry.maxOutputTokens >= entry.contextWindow) {
    throw new Error("最大输出 token 数须小于上下文窗口。");
  }
  return {
    models: editingId ? models.map((item) => item.id === editingId ? entry : item) : [...models, entry],
    model: !defaultModel || defaultModel === editingId ? entry.id : defaultModel,
  };
}

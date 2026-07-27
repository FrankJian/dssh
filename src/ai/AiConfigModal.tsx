import { useEffect } from "react";
import { Icon } from "../ui/Icon";
import { AiSettingsSection } from "./AiSettingsSection";
import type { AiConfig } from "./useAiConfig";

interface AiConfigModalProps {
  aiConfig: AiConfig;
  onClose: () => void;
}

export function AiConfigModal({ aiConfig, onClose }: AiConfigModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="settings-window ai-config-window" aria-label="AI 模型配置">
        <header className="settings-window__header">
          <h2>AI 模型配置</h2>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" height="16" width="16" />
          </button>
        </header>
        <div className="ai-config-window__body">
          <AiSettingsSection aiConfig={aiConfig} />
        </div>
      </section>
    </div>
  );
}

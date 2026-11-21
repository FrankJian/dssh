import { useDialogFocus } from "../ui/useDialogFocus";
import { Icon } from "../ui/Icon";
import { AiSettingsSection } from "./AiSettingsSection";
import type { AiConfig } from "./useAiConfig";
import type { AssistantDockControls } from "../app/useAssistantDock";

interface AiConfigModalProps {
  aiConfig: AiConfig;
  assistantDock?: AssistantDockControls;
  onClose: () => void;
}

export function AiConfigModal({ aiConfig, assistantDock, onClose }: AiConfigModalProps) {
  const dialogRef = useDialogFocus();

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section ref={dialogRef} className="settings-window ai-config-window" role="dialog" aria-modal="true" aria-label="AI 模型配置"
        onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); onClose(); } }}>
        <header className="settings-window__header">
          <h2>AI 模型配置</h2>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" height="16" width="16" />
          </button>
        </header>
        <div className="ai-config-window__body">
          <AiSettingsSection aiConfig={aiConfig} assistantDock={assistantDock} />
        </div>
      </section>
    </div>
  );
}

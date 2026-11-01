import { useState, type KeyboardEvent } from "react";
import type { JumpServerAsset, JumpServerNode } from "../models/jumpserver";
import type { ConnectionViewMode } from "../ui/ConnectionViewToggle";
import { Icon } from "../ui/Icon";
import { groupJumpServerAssets } from "./assetGroups";

export function JumpServerAssetViews({ assets, nodes, view, selectedId, onSelect, onConnect }: {
  assets: JumpServerAsset[];
  nodes: JumpServerNode[];
  view: ConnectionViewMode;
  selectedId: string | undefined;
  onSelect: (asset: JumpServerAsset) => void;
  onConnect: (asset: JumpServerAsset) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  function navigate(event: KeyboardEvent<HTMLButtonElement>, asset: JumpServerAsset) {
    if (event.key === "Enter") { event.preventDefault(); onConnect(asset); return; }
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.closest(".jumpserver__asset-content")!.querySelectorAll<HTMLButtonElement>(".jumpserver-asset__select:not(:disabled)"));
    const index = buttons.indexOf(event.currentTarget);
    const step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
    if (buttons[index + step]) { event.preventDefault(); buttons[index + step].focus(); }
  }
  function renderAssets(items: JumpServerAsset[], variant: "grid" | "list") {
    return <div className={`session-manager__cards is-${variant}`}>
      {items.map((asset) => <article key={asset.id}
        className={`conn-card jumpserver-asset${selectedId === asset.id ? " is-selected" : ""}${!asset.active ? " is-disabled" : ""}`}
        data-variant={variant}
        onClick={(event) => { if (asset.active && !(event.target as HTMLElement).closest("button")) onSelect(asset); }}
        onDoubleClick={(event) => { if (asset.active && !(event.target as HTMLElement).closest("button")) onConnect(asset); }}>
        <button type="button" className="conn-card__head jumpserver-asset__select" disabled={!asset.active}
          aria-label={`选择 ${asset.name}`} aria-pressed={selectedId === asset.id}
          onClick={() => onSelect(asset)} onDoubleClick={() => onConnect(asset)} onKeyDown={(event) => navigate(event, asset)}>
          <span className="conn-card__icon"><Icon name="server" height="18" width="18" /></span>
          <span className="conn-card__title"><span className="conn-card__name" title={asset.name}>{asset.name}</span>
            <span className="conn-card__host" title={asset.address}>{asset.address}</span></span>
        </button>
        <span className="conn-card__type">{asset.active ? "JumpServer" : "已禁用"}</span>
        <div className="conn-card__actions"><button type="button" className="conn-card__connect" disabled={!asset.active}
          aria-label={`连接 ${asset.name}`} onClick={() => onConnect(asset)}><Icon name="play" height="14" width="14" /><span>连接</span></button></div>
      </article>)}
    </div>;
  }
  return <div className="jumpserver__asset-content" data-view={view}>
    {view === "tree" ? <>
      <p className="jumpserver__group-hint">按资产目录分组 · 当前页资产可出现在多个目录下</p>
      {groupJumpServerAssets(assets, nodes).map((group) => <section className="session-manager__section" key={group.key}>
        <button type="button" className="session-manager__section-head" aria-expanded={!collapsed.has(group.key)}
          onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}>
          <Icon name={collapsed.has(group.key) ? "chevron-right" : "chevron-down"} height="14" width="14" />
          <Icon name="folder" height="15" width="15" /><span>{group.label}</span><span className="session-manager__section-count">{group.assets.length}</span>
        </button>
        {!collapsed.has(group.key) && renderAssets(group.assets, "list")}
      </section>)}
    </> : renderAssets(assets, view)}
  </div>;
}

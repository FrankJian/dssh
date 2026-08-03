import type { KubernetesProfile } from "../models";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

interface KubernetesConnectionCardProps {
  profile: KubernetesProfile;
  sourceAvailable: boolean;
  variant: "grid" | "list";
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function KubernetesConnectionCard({ profile, sourceAvailable, variant, onOpen, onEdit, onDelete, onToggleFavorite }: KubernetesConnectionCardProps) {
  const source = profile.source.kind === "local"
    ? "本机 kubeconfig"
    : profile.source.kind === "localImported"
      ? "系统凭据存储"
      : "远端 SSH";
  const canOpen = sourceAvailable && profile.selectedContexts.length > 0;
  return <article className="conn-card" data-variant={variant} onDoubleClick={canOpen ? onOpen : undefined}>
    <div className="conn-card__head">
      <span className="conn-card__icon"><Icon name="database" height="18" width="18" /></span>
      <div className="conn-card__title"><span className="conn-card__name">{profile.name}</span><span className="conn-card__host">{sourceAvailable ? `${source} · ${profile.selectedContexts.length} 个 context` : "远端 SSH 来源已删除，请重新选择"}</span></div>
      <IconButton active={profile.favorite} className="conn-card__fav" label={profile.favorite ? "取消收藏" : "收藏"} onClick={onToggleFavorite}><Icon name="star" height="16" width="16" /></IconButton>
    </div>
    {profile.tags.length > 0 ? <div className="conn-card__tags">{profile.tags.slice(0, 4).map((tag) => <span className="conn-card__tag" key={tag}>{tag}</span>)}</div> : null}
    <span className="conn-card__type">Kubernetes</span>
    <div className="conn-card__actions">
      <button className="conn-card__connect" disabled={!canOpen} onClick={onOpen} type="button"><Icon name="play" height="14" width="14" /><span>打开</span></button>
      <IconButton label="编辑" onClick={onEdit}><Icon name="edit" height="16" width="16" /></IconButton>
      <IconButton label="删除" onClick={onDelete}><Icon name="trash" height="16" width="16" /></IconButton>
    </div>
  </article>;
}

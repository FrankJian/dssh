import type { KubernetesProfile } from "../models";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

interface KubernetesConnectionCardProps {
  profile: KubernetesProfile;
  variant: "grid" | "list";
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function KubernetesConnectionCard({ profile, variant, onOpen, onEdit, onDelete, onToggleFavorite }: KubernetesConnectionCardProps) {
  const source = profile.source.kind === "local" ? "本机 kubeconfig" : "远端 SSH";
  return <article className="conn-card" data-variant={variant} onDoubleClick={onOpen}>
    <div className="conn-card__head">
      <span className="conn-card__icon"><Icon name="database" height="18" width="18" /></span>
      <div className="conn-card__title"><span className="conn-card__name">{profile.name}</span><span className="conn-card__host">{source} · {profile.selectedContexts.length} 个 context</span></div>
      <IconButton active={profile.favorite} className="conn-card__fav" label={profile.favorite ? "取消收藏" : "收藏"} onClick={onToggleFavorite}><Icon name="star" height="16" width="16" /></IconButton>
    </div>
    {profile.tags.length > 0 ? <div className="conn-card__tags">{profile.tags.slice(0, 4).map((tag) => <span className="conn-card__tag" key={tag}>{tag}</span>)}</div> : null}
    <span className="conn-card__type">Kubernetes</span>
    <div className="conn-card__actions">
      <button className="conn-card__connect" disabled={profile.selectedContexts.length === 0} onClick={onOpen} type="button"><Icon name="play" height="14" width="14" /><span>打开</span></button>
      <IconButton label="编辑" onClick={onEdit}><Icon name="edit" height="16" width="16" /></IconButton>
      <IconButton label="删除" onClick={onDelete}><Icon name="trash" height="16" width="16" /></IconButton>
    </div>
  </article>;
}

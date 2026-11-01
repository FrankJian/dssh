import type { SshProfile } from "../models";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { connectionTypeLabel, connectionTypeForProfile } from "./connectionTypes";
import { profileIconName } from "./profileIcons";

interface ConnectionCardProps {
  profile: SshProfile;
  variant: "grid" | "list";
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

/**
 * A saved-connection card for the Session Manager. The same markup renders as a
 * vertical card (grid) or a compact horizontal row (list) via `data-variant`.
 */
export function ConnectionCard({
  profile,
  variant,
  onConnect,
  onEdit,
  onDelete,
  onToggleFavorite,
}: ConnectionCardProps) {
  return (
    <article className="conn-card" data-variant={variant} onDoubleClick={(event) => {
      if (!(event.target as HTMLElement).closest("button")) onConnect();
    }}>
      <div className="conn-card__head">
        <span className="conn-card__icon">
          <Icon name={profileIconName(profile.icon)} height="18" width="18" />
        </span>
        <div className="conn-card__title">
          <span className="conn-card__name" title={profile.name}>{profile.name}</span>
          <span className="conn-card__host" title={`${profile.username}@${profile.host}:${profile.port}`}>
            {profile.username}@{profile.host}:{profile.port}
          </span>
        </div>
        <IconButton
          active={profile.favorite}
          className="conn-card__fav"
          label={profile.favorite ? "取消收藏" : "收藏"}
          onClick={onToggleFavorite}
        >
          <Icon name="star" height="16" width="16" />
        </IconButton>
      </div>

      {profile.tags.length > 0 || variant === "list" ? (
        <div className="conn-card__tags">
          {profile.tags.slice(0, 4).map((tag) => (
            <span className="conn-card__tag" key={tag} title={tag}>
              {tag}
            </span>
          ))}
          {profile.tags.length > 4 ? <span className="conn-card__tag" title={profile.tags.slice(4).join("、")}>+{profile.tags.length - 4}</span> : null}
        </div>
      ) : null}

      {variant === "grid" && profile.description ? <p className="conn-card__description" title={profile.description}>{profile.description}</p> : null}

      <span className="conn-card__type">{connectionTypeLabel(connectionTypeForProfile(profile))}</span>

      <div className="conn-card__actions">
        <button className="conn-card__connect" aria-label={`连接 ${profile.name}`} onClick={onConnect} type="button">
          <Icon name="play" height="14" width="14" />
          <span>连接</span>
        </button>
        <IconButton label="编辑" onClick={onEdit}>
          <Icon name="edit" height="16" width="16" />
        </IconButton>
        <IconButton label="删除" onClick={onDelete}>
          <Icon name="trash" height="16" width="16" />
        </IconButton>
      </div>
    </article>
  );
}

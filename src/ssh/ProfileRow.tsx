import type { SshProfile } from "../models";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

interface ProfileRowProps {
  isSelected: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onConnect: () => void;
  onSelect: () => void;
  onToggleFavorite: () => void;
  profile: SshProfile;
}

export function ProfileRow({
  isSelected,
  onConnect,
  onDelete,
  onEdit,
  onSelect,
  onToggleFavorite,
  profile,
}: ProfileRowProps) {
  return (
    <article className="profile-row" data-selected={isSelected} role="listitem">
      <button
        className="profile-row__content"
        onClick={onSelect}
        onDoubleClick={onConnect}
        type="button"
      >
        <span className="profile-row__main">
          <span className="profile-row__name">{profile.name}</span>
        </span>
        <span className="profile-row__host">
          {profile.username}@{profile.host}:{profile.port}
        </span>
        {profile.description ? (
          <span className="profile-row__description">{profile.description}</span>
        ) : null}
      </button>
      <div className="profile-row__actions">
        <IconButton
          active={profile.favorite}
          label={profile.favorite ? "取消收藏" : "收藏"}
          onClick={onToggleFavorite}
        >
          <Icon name="star" />
        </IconButton>
        <IconButton label="编辑" onClick={onEdit}>
          <Icon name="edit" />
        </IconButton>
        <IconButton label="连接" onClick={onConnect}>
          <Icon name="play" />
        </IconButton>
        <IconButton label="删除" onClick={onDelete}>
          <Icon name="trash" />
        </IconButton>
      </div>
    </article>
  );
}

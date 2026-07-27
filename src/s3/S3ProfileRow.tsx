import type { S3Profile } from "../models";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

interface Props {
  profile: S3Profile;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function S3ProfileRow({
  profile,
  selected,
  onDelete,
  onEdit,
  onOpen,
  onSelect,
  onToggleFavorite,
}: Props) {
  return (
    <article className="profile-row" data-selected={selected} role="listitem">
      <button
        className="profile-row__content"
        onClick={onSelect}
        type="button"
      >
        <span className="profile-row__name">{profile.name}</span>
        <span className="profile-row__host">
          {profile.host}:{profile.port}
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
        <IconButton label="浏览" onClick={onOpen}>
          <Icon name="folder" />
        </IconButton>
        <IconButton label="删除" onClick={onDelete}>
          <Icon name="trash" />
        </IconButton>
      </div>
    </article>
  );
}

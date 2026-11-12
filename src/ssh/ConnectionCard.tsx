import { smbConnectionAddress } from "../models/smb";
import { isMacOS } from "../platform";
import { ConnectionAddress } from "./ConnectionAddress";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { connectionTypeLabel, connectionTypeForProfile, isRdpProfile, isJumpServerProfile, isSmbProfile, type ConnectionProfile } from "./connectionTypes";
import { profileIconName, sftpConnectionIconName } from "./profileIcons";

interface ConnectionCardProps {
  profile: ConnectionProfile;
  variant: "grid" | "list";
  onConnect: () => void;
  onOpenSftp?: () => void;
  onDisconnect?: () => void;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}

export function ConnectionCard({
  profile, variant, onConnect, onOpenSftp, onDisconnect, onEdit, onClone, onDelete,
}: ConnectionCardProps) {
  const jumpserver = isJumpServerProfile(profile);
  const type = connectionTypeForProfile(profile);
  const typeLabel = connectionTypeLabel(type);
  const actionLabel = jumpserver ? "打开资产" : type === "sftp" ? "打开 SFTP" : type === "smb" ? (isMacOS ? "在 Finder 中打开" : "映射并打开") : "连接";
  const visibleTagCount = variant === "grid" ? 2 : 4;
  const address = jumpserver ? profile.coreUrl : isSmbProfile(profile) ? smbConnectionAddress(profile) : `${profile.username}@${profile.host}:${profile.port}`;
  const details = <>
    <ConnectionAddress address={address} />
    {profile.folder ? <span className="conn-card__folder" title={profile.folder}>
      <Icon name="folder" width="12" height="12" /><span>{profile.folder}</span>
    </span> : null}
    {isRdpProfile(profile) && profile.skipCertificateVerification ? <span className="conn-card__warning">
      <Icon name="shield" width="12" height="12" />未验证证书
    </span> : null}
  </>;

  return (
    <article className="conn-card" aria-label={`${typeLabel} 连接 ${profile.name}`} data-variant={variant} data-profile-type={type}
      onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button")) onConnect(); }}>
      <div className="conn-card__head">
        <span className="conn-card__icon">
          <Icon
            className={type === "sftp" ? "sftp-connection-icon" : undefined}
            name={jumpserver ? "stackedHexagon" : isRdpProfile(profile) ? "monitor" : isSmbProfile(profile) ? "folder" : type === "sftp" ? sftpConnectionIconName(profile.icon) : profileIconName(profile.icon)}
            height="18"
            width="18"
          />
        </span>
        <div className="conn-card__title">
          <div className="conn-card__name-row">
            <span className="conn-card__name" title={profile.name}>{profile.name}</span>
            {variant === "grid" ? <span className="conn-card__type">{typeLabel}</span> : null}
          </div>
          {variant === "list" ? details : null}
        </div>

      </div>

      {variant === "grid" ? <div className="conn-card__details">
        {details}
        {profile.description ? <p className="conn-card__description" title={profile.description}>{profile.description}</p> : null}
      </div> : null}

      {profile.tags.length > 0 || variant === "list" ? <div className="conn-card__tags">
        {profile.tags.slice(0, visibleTagCount).map((tag) => <span className="conn-card__tag" key={tag} title={tag}>{tag}</span>)}
        {profile.tags.length > visibleTagCount ? <span className="conn-card__tag conn-card__tag--overflow" title={profile.tags.slice(visibleTagCount).join("、")}>+{profile.tags.length - visibleTagCount}</span> : null}
      </div> : null}

      {variant === "list" ? <span className="conn-card__type">{typeLabel}</span> : null}

      <div className="conn-card__actions">
        <button className="conn-card__connect" aria-label={`${actionLabel} ${profile.name}`} onClick={onConnect} type="button">
          <Icon name="play" height="14" width="14" /><span>{actionLabel}</span>
        </button>
        <div className="conn-card__tools" role="group" aria-label="连接操作">
          {onOpenSftp ? <IconButton label="打开 SFTP" onClick={onOpenSftp}><Icon name="folder" height="16" width="16" /></IconButton> : null}
          {onDisconnect ? <IconButton label="断开盘符映射" onClick={onDisconnect}><Icon name="close" height="16" width="16" /></IconButton> : null}
          <IconButton label="编辑" onClick={onEdit}><Icon name="edit" height="16" width="16" /></IconButton>
          <IconButton label="克隆" onClick={onClone}><Icon name="copy" height="16" width="16" /></IconButton>
          <IconButton className="conn-card__delete" label="删除" onClick={onDelete}><Icon name="trash" height="16" width="16" /></IconButton>
        </div>
      </div>
    </article>
  );
}

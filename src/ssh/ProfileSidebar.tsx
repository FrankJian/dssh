import { useMemo, useState } from "react";
import type { SshProfile } from "../models";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { SearchField } from "../ui/SearchField";
import { SectionHeader } from "../ui/SectionHeader";
import { groupProfiles } from "./profileGroups";
import { ProfileRow } from "./ProfileRow";

interface ProfileSidebarProps {
  activeSessionCount: number;
  onConnectProfile: (profile: SshProfile) => void;
  onCreateProfile: () => void;
  onDeleteProfile: (profileId: string) => void;
  onEditProfile: (profile: SshProfile) => void;
  onSelectProfile: (profileId: string) => void;
  onToggleFavorite: (profileId: string) => void;
  errorMessage: string | null;
  isLoading: boolean;
  profiles: SshProfile[];
  query: string;
  selectedProfileId: string | null;
  totalProfileCount: number;
  onQueryChange: (query: string) => void;
}

export function ProfileSidebar({
  activeSessionCount,
  onConnectProfile,
  onCreateProfile,
  onDeleteProfile,
  onEditProfile,
  onQueryChange,
  onSelectProfile,
  onToggleFavorite,
  errorMessage,
  isLoading,
  profiles,
  query,
  selectedProfileId,
  totalProfileCount,
}: ProfileSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupProfiles(profiles), [profiles]);
  // While searching, force every matching group open so results stay visible
  // regardless of the user's manual collapse state.
  const isSearching = query.trim().length > 0;

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <aside className="sidebar is-glass-chrome" aria-label="SSH 配置">
      <div className="sidebar__top">
        <SectionHeader title="SSH 配置" />
        <IconButton className="icon-button--primary" label="新建 SSH 配置" onClick={onCreateProfile}>
          <Icon name="plus" />
        </IconButton>
      </div>
      <SearchField
        id="profile-search"
        label="搜索配置"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder="按名称、主机或用户搜索"
        value={query}
      />
      <div className="sidebar__meta">
        <span>
          {profiles.length} / {totalProfileCount} 个配置
        </span>
        <span>{isLoading ? "加载中" : `${activeSessionCount} 个会话`}</span>
      </div>
      {errorMessage ? <div className="sidebar__error">{errorMessage}</div> : null}
      <div className="profile-list" role="list">
        {isLoading ? (
          <div className="profile-list__empty">正在加载配置...</div>
        ) : groups.length > 0 ? (
          groups.map((group) => {
            const isCollapsed = !isSearching && collapsedGroups.has(group.key);
            return (
              <div className="profile-group" key={group.key}>
                <button
                  aria-expanded={!isCollapsed}
                  className="profile-group__header"
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                >
                  <span className="profile-group__chevron" data-collapsed={isCollapsed}>
                    <Icon name="chevron-right" height="14" width="14" />
                  </span>
                  <span className="profile-group__label">{group.label}</span>
                  <span className="profile-group__count">{group.profiles.length}</span>
                </button>
                {isCollapsed
                  ? null
                  : group.profiles.map((profile) => (
                      <ProfileRow
                        isSelected={profile.id === selectedProfileId}
                        key={`${group.key}:${profile.id}`}
                        onConnect={() => onConnectProfile(profile)}
                        onDelete={() => onDeleteProfile(profile.id)}
                        onEdit={() => onEditProfile(profile)}
                        onSelect={() => onSelectProfile(profile.id)}
                        onToggleFavorite={() => onToggleFavorite(profile.id)}
                        profile={profile}
                      />
                    ))}
              </div>
            );
          })
        ) : (
          <div className="profile-list__empty">没有匹配的 SSH 配置。</div>
        )}
      </div>
    </aside>
  );
}

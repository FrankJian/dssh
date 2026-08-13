import type { S3Profile } from "../models";
import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { SearchField } from "../ui/SearchField";
import { SectionHeader } from "../ui/SectionHeader";
import { S3ProfileRow } from "./S3ProfileRow";

interface ProfileGroup {
  key: string;
  label: string;
  profiles: S3Profile[];
}

const UNCLASSIFIED_KEY = "__unclassified__";

function groupProfiles(profiles: S3Profile[]): ProfileGroup[] {
  const tags = new Set<string>();
  for (const profile of profiles) {
    for (const tag of profile.tags) {
      tags.add(tag);
    }
  }

  const sortProfiles = (items: S3Profile[]) =>
    [...items].sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) || left.name.localeCompare(right.name),
    );

  const groups = Array.from(tags)
    .sort((left, right) => left.localeCompare(right))
    .map((tag) => ({
      key: `tag:${tag}`,
      label: tag,
      profiles: sortProfiles(profiles.filter((profile) => profile.tags.includes(tag))),
    }));

  const unclassified = profiles.filter((profile) => profile.tags.length === 0);
  if (unclassified.length) {
    groups.push({
      key: UNCLASSIFIED_KEY,
      label: "未分类",
      profiles: sortProfiles(unclassified),
    });
  }
  return groups;
}

interface Props {
  profiles: S3Profile[];
  totalCount: number;
  selectedProfileId: string | null;
  query: string;
  isLoading: boolean;
  errorMessage: string | null;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onOpen: (profile: S3Profile) => void;
  onCreate: () => void;
  onEdit: (profile: S3Profile) => void;
  onDelete: (profile: S3Profile) => void;
  onToggleFavorite: (id: string) => void;
}

export function S3ProfileSidebar(props: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupProfiles(props.profiles), [props.profiles]);
  const isSearching = props.query.trim().length > 0;

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
    <aside className="sidebar is-glass-chrome" aria-label="S3 配置">
      <div className="sidebar__top">
        <SectionHeader title="对象存储 (S3)" />
        <IconButton className="icon-button--primary" label="新建 S3 配置" onClick={props.onCreate}>
          <Icon name="plus" />
        </IconButton>
      </div>
      <SearchField
        id="s3-profile-search"
        label="搜索配置"
        onChange={(event) => props.onQueryChange(event.currentTarget.value)}
        placeholder="按名称、区域或端点搜索"
        value={props.query}
      />
      <div className="sidebar__meta">
        <span>{props.profiles.length} / {props.totalCount} 个配置</span>
        <span>{props.isLoading ? "加载中" : "点击打开标签页"}</span>
      </div>
      {props.errorMessage ? <div className="sidebar__error">{props.errorMessage}</div> : null}
      <div className="profile-list" role="list">
        {props.isLoading ? (
          <div className="profile-list__empty">正在加载配置...</div>
        ) : groups.length ? (
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
                      <S3ProfileRow
                        key={`${group.key}:${profile.id}`}
                        onDelete={() => props.onDelete(profile)}
                        onEdit={() => props.onEdit(profile)}
                        onOpen={() => props.onOpen(profile)}
                        onSelect={() => props.onSelect(profile.id)}
                        onToggleFavorite={() => props.onToggleFavorite(profile.id)}
                        profile={profile}
                        selected={profile.id === props.selectedProfileId}
                      />
                    ))}
              </div>
            );
          })
        ) : (
          <div className="profile-list__empty">没有匹配的 S3 配置。</div>
        )}
      </div>
    </aside>
  );
}

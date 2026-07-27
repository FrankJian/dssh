import type { S3Profile } from "../models";
import { Icon } from "../ui/Icon";
import { S3ObjectBrowser } from "./S3ObjectBrowser";

interface Props {
  activeProfileId: string | null;
  downloadConcurrency: number;
  onActivate: (profileId: string) => void;
  onClose: (profileId: string) => void;
  profiles: S3Profile[];
  tabProfileIds: string[];
  uploadConcurrency: number;
}

export function S3Workspace({
  activeProfileId,
  downloadConcurrency,
  onActivate,
  onClose,
  profiles,
  tabProfileIds,
  uploadConcurrency,
}: Props) {
  const tabs = tabProfileIds
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is S3Profile => Boolean(profile));

  if (!tabs.length) {
    return <S3ObjectBrowser downloadConcurrency={downloadConcurrency} profile={null} uploadConcurrency={uploadConcurrency} />;
  }

  return (
    <section className="s3-workspace" aria-label="S3 连接标签页">
      <div className="s3-workspace__tabs tab-strip" role="tablist">
        {tabs.map((profile) => {
          const active = profile.id === activeProfileId;
          return (
            <div
              aria-selected={active}
              className={`tab${active ? " is-active" : ""}`}
              key={profile.id}
              onClick={() => onActivate(profile.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onActivate(profile.id);
                }
              }}
              role="tab"
              tabIndex={0}
            >
              <Icon name="bucket" height="15" width="15" />
              <span className="tab__title">{profile.name}</span>
              <span
                aria-label={`关闭 ${profile.name}`}
                className="tab__action tab__close"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(profile.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(profile.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <Icon name="close" height="13" width="13" />
              </span>
            </div>
          );
        })}
      </div>
      <div className="s3-workspace__pages">
        {tabs.map((profile) => (
          <div
            aria-hidden={profile.id !== activeProfileId}
            className={`s3-workspace__page${profile.id === activeProfileId ? " is-active" : ""}`}
            key={profile.id}
          >
            <S3ObjectBrowser
              downloadConcurrency={downloadConcurrency}
              profile={profile}
              uploadConcurrency={uploadConcurrency}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

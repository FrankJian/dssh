import type { ArtifactoryChild, ArtifactoryItemInfo } from "../services/artifactoryService";
import { Icon } from "../ui/Icon";

interface Props {
  selected: ArtifactoryChild | null;
  name: string;
  path: string;
  repo: string;
  details: ArtifactoryItemInfo | null;
  canEditProperties: boolean;
  canDownload: boolean;
  onAddProperty: () => void;
  onEditProperty: (key: string, values: string[]) => void;
  onDownload: () => void;
}

function sizeOf(value?: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

export function ArtifactoryDetails({ selected, name, path, repo, details, canDownload, canEditProperties, onAddProperty, onEditProperty, onDownload }: Props) {
  return <aside className="artifactory-details" aria-label="文件详情">
    <h3>文件详情</h3>
    {!selected ? <p className="artifactory-muted">选择文件或目录查看元数据。</p> : <>
      <div className="artifactory-details__name"><Icon name={selected.folder ? "folder" : "file"} />{name}</div>
      <button className="artifactory-details__download" disabled={!canDownload} onClick={onDownload} title={!canDownload ? "仅支持本地或缓存仓库" : undefined} type="button"><Icon name="download" />{selected.folder ? "下载目录 ZIP" : "下载文件"}</button>
      <dl><dt>路径</dt><dd>{repo}/{path}{name}</dd><dt>大小</dt><dd>{selected.folder ? "—" : sizeOf(details?.size)}</dd><dt>类型</dt><dd>{details?.mimeType ?? (selected.folder ? "目录" : "—")}</dd><dt>创建时间</dt><dd>{details?.created ?? "—"}</dd><dt>修改时间</dt><dd>{details?.lastModified ?? "—"}</dd><dt>创建者</dt><dd>{details?.createdBy ?? "—"}</dd><dt>修改者</dt><dd>{details?.modifiedBy ?? "—"}</dd></dl>
      <h4>校验和</h4>{Object.entries(details?.checksums ?? {}).map(([key, value]) => <div className="artifactory-property" key={key}><span>{key}</span><code title={value}>{value}</code></div>)}
      <div className="artifactory-details__properties-head"><h4>属性</h4>{canEditProperties && <button aria-label="添加属性" onClick={onAddProperty} title="添加属性" type="button"><Icon name="plus" /></button>}</div>
      {Object.entries(details?.properties ?? {}).map(([key, value]) => <div className="artifactory-property artifactory-property--editable" key={key}><span>{key}</span><code title={value.join(", ")}>{value.join(", ")}</code>{canEditProperties && <button aria-label={`编辑属性 ${key}`} onClick={() => onEditProperty(key, value)} title="编辑属性" type="button"><Icon name="edit" /></button>}</div>)}
      {details?.propertiesError ? <p className="artifactory-muted">属性读取失败：{details.propertiesError}</p> : !Object.keys(details?.properties ?? {}).length && <p className="artifactory-muted">无自定义属性</p>}
      {!canEditProperties && <p className="artifactory-muted">该仓库类型仅支持查看属性。</p>}
    </>}
  </aside>;
}

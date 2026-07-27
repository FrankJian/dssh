import { useEffect, useState, type FormEvent } from "react";
import type { S3CannedAcl } from "../models";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

const ACLS: Array<{ value: S3CannedAcl; label: string }> = [
  { value: "private", label: "私有（推荐）" },
  { value: "public-read", label: "公开读取" },
  { value: "public-read-write", label: "公开读写" },
  { value: "authenticated-read", label: "已认证用户读取" },
];

interface Props {
  objectKey: string;
  onClose: () => void;
  onLoadAcl: () => Promise<S3CannedAcl>;
  onSubmit: (acl: S3CannedAcl) => Promise<void>;
}

export function CannedAclDialog({ objectKey, onClose, onLoadAcl, onSubmit }: Props) {
  const [acl, setAcl] = useState<S3CannedAcl>("private");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void onLoadAcl()
      .then((value) => {
        if (!cancelled) setAcl(value);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "读取对象 ACL 失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadAcl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(acl);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新 ACL 失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="s3-acl-dialog" aria-label="设置对象 ACL">
        <header className="profile-editor__topbar">
          <h2>设置对象 ACL</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <form className="s3-acl-dialog__body" onSubmit={submit}>
          <div className="s3-dialog-key" title={objectKey}>{objectKey}</div>
          <label className="field">
            <span>预设访问控制</span>
            <select disabled={loading || saving} value={acl} onChange={(event) => setAcl(event.currentTarget.value as S3CannedAcl)}>
              {ACLS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <p className="s3-dialog-warning">公开 ACL 可能使对象可被互联网访问，请确认存储桶策略允许该操作。</p>
          {error ? <div className="form-errors">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button onClick={onClose} variant="ghost">取消</Button>
            <Button disabled={loading || saving} type="submit" variant="primary">{loading ? "读取 ACL..." : saving ? "应用中..." : "应用"}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

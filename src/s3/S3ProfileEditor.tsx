import { useEffect, useRef, useState, type FormEvent } from "react";
import type { S3Profile } from "../models";
import { testS3Connection, testSavedS3Profile } from "../services/s3Service";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import {
  createEmptyS3ProfileDraft,
  s3ProfileToDraft,
  type S3ProfileDraft,
  type S3ProfileEditorMode,
} from "./profileTypes";

interface Props {
  mode: S3ProfileEditorMode;
  profile: S3Profile | null;
  onClose: () => void;
  onSubmit: (draft: S3ProfileDraft) => Promise<void>;
}

export function S3ProfileEditor({ mode, profile, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState(() =>
    profile ? s3ProfileToDraft(profile) : createEmptyS3ProfileDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSucceeded, setTestSucceeded] = useState(false);
  const testSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (testSuccessTimer.current) {
      clearTimeout(testSuccessTimer.current);
      testSuccessTimer.current = null;
    }
    setDraft(profile ? s3ProfileToDraft(profile) : createEmptyS3ProfileDraft());
    setError(null);
    setTestSucceeded(false);
  }, [profile]);

  useEffect(
    () => () => {
      if (testSuccessTimer.current) {
        clearTimeout(testSuccessTimer.current);
      }
    },
    [],
  );

  function update<K extends keyof S3ProfileDraft>(key: K, value: S3ProfileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !draft.name.trim() ||
      !draft.host.trim() ||
      !Number.isInteger(Number(draft.port)) ||
      Number(draft.port) < 1 ||
      Number(draft.port) > 65535 ||
      !draft.accessKeyId.trim()
    ) {
      setError("名称、主机名、有效端口和 Access Key ID 为必填项。");
      return;
    }
    if (mode === "create" && !draft.secretAccessKey) {
      setError("新建配置时必须填写 Secret Access Key。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存 S3 配置失败。");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (
      !draft.name.trim() ||
      !draft.host.trim() ||
      !Number.isInteger(Number(draft.port)) ||
      Number(draft.port) < 1 ||
      Number(draft.port) > 65535 ||
      !draft.accessKeyId.trim()
    ) {
      setError("名称、主机名、有效端口和 Access Key ID 为必填项。");
      return;
    }
    if (!profile && !draft.secretAccessKey) {
      setError("测试新配置时必须填写 Secret Access Key。");
      return;
    }
    setTesting(true);
    setError(null);
    setTestSucceeded(false);
    try {
      if (profile && !draft.secretAccessKey) {
        await testSavedS3Profile(profile.id);
      } else {
        await testS3Connection({
          name: draft.name.trim(),
          host: draft.host.trim(),
          port: Number.parseInt(draft.port, 10),
          useTls: draft.useTls,
          accessKeyId: draft.accessKeyId.trim(),
          secretAccessKey: draft.secretAccessKey,
          sessionToken: draft.sessionToken.trim() || undefined,
          forcePathStyle: draft.forcePathStyle,
          defaultBucket: draft.defaultBucket.trim() || undefined,
          defaultAcl: draft.defaultAcl || undefined,
          favorite: draft.favorite,
          description: draft.description.trim() || undefined,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        });
      }
      setTestSucceeded(true);
      if (testSuccessTimer.current) {
        clearTimeout(testSuccessTimer.current);
      }
      testSuccessTimer.current = setTimeout(() => {
        setTestSucceeded(false);
        testSuccessTimer.current = null;
      }, 3000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "连接测试失败。");
    } finally {
      setTesting(false);
    }
  }

  const title = mode === "create" ? "新建 S3 配置" : "编辑 S3 配置";
  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="profile-editor profile-editor--s3 is-glass-overlay" aria-label={title}>
        <header className="profile-editor__topbar">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭编辑器" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <form className="profile-form profile-form--s3" onSubmit={submit}>
          <div className="profile-form__scroll">
            {error ? <div className="form-errors">{error}</div> : null}
            <div className="profile-form__section-title">连接</div>
            <div className="form-grid">
              <label className="field">
                <span>配置名称</span>
                <input autoFocus value={draft.name} onChange={(e) => update("name", e.currentTarget.value)} />
              </label>
              <label className="field">
                <span>加密</span>
                <select
                  value={draft.useTls ? "tls" : "none"}
                  onChange={(event) => update("useTls", event.currentTarget.value === "tls")}
                >
                  <option value="tls">TLS/SSL 隐式加密</option>
                  <option value="none">不加密（仅限可信内网）</option>
                </select>
              </label>
            </div>
            <div className="profile-form__section-title">凭据</div>
            <div className="form-grid">
              <label className="field">
                <span>主机名</span>
                <input
                  placeholder="s3.amazonaws.com"
                  value={draft.host}
                  onChange={(e) => update("host", e.currentTarget.value)}
                />
              </label>
              <label className="field">
                <span>端口号</span>
                <input
                  inputMode="numeric"
                  value={draft.port}
                  onChange={(e) => update("port", e.currentTarget.value)}
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Access Key ID</span>
                <input value={draft.accessKeyId} onChange={(e) => update("accessKeyId", e.currentTarget.value)} />
              </label>
              <label className="field">
                <span>{mode === "create" ? "Secret Access Key" : "Secret Access Key（留空保持不变）"}</span>
                <input type="password" value={draft.secretAccessKey} onChange={(e) => update("secretAccessKey", e.currentTarget.value)} />
              </label>
            </div>
            <label className="field">
              <span>Session Token（可选）</span>
              <input type="password" value={draft.sessionToken} onChange={(e) => update("sessionToken", e.currentTarget.value)} />
            </label>
            <details className="profile-form__advanced">
              <summary>高级选项</summary>
              <div className="profile-form__advanced-content">
                <div className="form-grid">
                <label className="field">
                  <span>默认存储桶（可选）</span>
                  <input
                    placeholder="打开配置时自动进入"
                    value={draft.defaultBucket}
                    onChange={(e) => update("defaultBucket", e.currentTarget.value)}
                  />
                </label>
                <label className="field">
                  <span>默认上传权限</span>
                  <select
                    value={draft.defaultAcl}
                    onChange={(e) =>
                      update("defaultAcl", e.currentTarget.value as S3ProfileDraft["defaultAcl"])
                    }
                  >
                    <option value="">不发送 ACL（推荐）</option>
                    <option value="private">private</option>
                    <option value="public-read">public-read</option>
                    <option value="public-read-write">public-read-write</option>
                    <option value="authenticated-read">authenticated-read</option>
                  </select>
                </label>
              </div>
                <label className="field">
                  <span>标签（逗号分隔）</span>
                  <input
                    placeholder="生产, 备份"
                    value={draft.tags}
                    onChange={(e) => update("tags", e.currentTarget.value)}
                  />
                </label>
                <label className="field">
                  <span>描述</span>
                  <textarea rows={2} value={draft.description} onChange={(e) => update("description", e.currentTarget.value)} />
                </label>
                <div className="profile-form__toggles">
                  <label className="checkbox-field">
                    <input type="checkbox" checked={draft.forcePathStyle} onChange={(e) => update("forcePathStyle", e.currentTarget.checked)} />
                    强制使用路径式访问
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={draft.favorite} onChange={(e) => update("favorite", e.currentTarget.checked)} />
                    设为收藏
                  </label>
                </div>
              </div>
            </details>
          </div>
          <footer className="profile-editor__footer">
            <Button
              className={`s3-profile-editor__test${testSucceeded ? " is-success" : ""}`}
              disabled={testing || saving}
              onClick={() => void testConnection()}
              variant="secondary"
            >
              {testing ? "测试中..." : testSucceeded ? <><Icon name="check" height="15" width="15" />连接成功</> : "测试连接"}
            </Button>
            <Button onClick={onClose} variant="secondary">取消</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

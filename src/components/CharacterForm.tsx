import { useEffect, useState } from "react";
import type { Character, CharacterDraft } from "../types";
import { api } from "../api";

const EMPTY: CharacterDraft = {
  name: "",
  persona: "",
  languageStyle: "",
  faction: "",
  backstory: "",
  voiceId: "",
  speed: 1,
  defaultEmotion: "",
  avatar: "",
};

export function CharacterForm({
  editing,
  seed,
  onSubmit,
  onCancel,
  onClear,
}: {
  editing: Character | null;
  /** When set (and not editing), fill the form with this draft. */
  seed?: { key: number; draft: CharacterDraft } | null;
  onSubmit: (draft: CharacterDraft) => void;
  onCancel: () => void;
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState<CharacterDraft>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; backstory?: string }>({});

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("图片太大，不能超过 5MB");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      if (!dataUrl) {
        setUploading(false);
        return;
      }

      const base64 = dataUrl.split(",")[1];
      try {
        const res = await api.uploadFile(file.name, base64);
        set("avatar", res.url);
      } catch (err) {
        setUploadError(String(err instanceof Error ? err.message : err));
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setUploadError("文件读取失败");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    if (editing) {
      const { id: _id, ...rest } = editing;
      setDraft({
        ...EMPTY,
        ...rest,
        avatar: rest.avatar || "",
      });
    } else if (seed) {
      setDraft({
        ...EMPTY,
        ...seed.draft,
        voiceId: "",
        avatar: "",
      });
    } else {
      setDraft(EMPTY);
    }
    setFieldErrors({});
  }, [editing, seed?.key]);

  function set<K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "name" || key === "backstory") {
      setFieldErrors((err) => {
        if (!err[key]) return err;
        const next = { ...err };
        delete next[key];
        return next;
      });
    }
  }

  function validate(): boolean {
    const next: { name?: string; backstory?: string } = {};
    if (!draft.name.trim()) next.name = "请填写角色名";
    if (!draft.backstory.trim()) next.backstory = "请填写过往经历";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handlePolish() {
    setPolishError(null);
    setPolishing(true);
    try {
      const polished = await api.polishCharacter({
        name: draft.name,
        persona: draft.persona,
        languageStyle: draft.languageStyle,
        faction: draft.faction,
        backstory: draft.backstory,
        defaultEmotion: draft.defaultEmotion,
        speed: draft.speed,
      });
      setDraft((d) => ({
        ...d,
        name: polished.name,
        persona: polished.persona,
        languageStyle: polished.languageStyle,
        faction: polished.faction,
        backstory: polished.backstory,
        defaultEmotion: polished.defaultEmotion,
        speed: polished.speed,
        // keep avatar & voiceId untouched
      }));
    } catch (e) {
      setPolishError(String(e instanceof Error ? e.message : e));
    } finally {
      setPolishing(false);
    }
  }

  const canPolish =
    !polishing &&
    Boolean(
      draft.name.trim() ||
        draft.persona.trim() ||
        draft.languageStyle.trim() ||
        draft.faction.trim() ||
        draft.backstory.trim() ||
        draft.defaultEmotion.trim()
    );

  return (
    <form
      className="card form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!validate()) return;
        onSubmit(draft);
      }}
    >
      <div className="form-header">
        <h2>{editing ? "编辑角色" : "新建角色"}</h2>
      </div>

      {polishError && <p className="error">⚠ {polishError}</p>}

      <label>
        角色名
        <input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="例如：老陈"
          className={fieldErrors.name ? "invalid" : undefined}
          aria-invalid={Boolean(fieldErrors.name)}
        />
        {fieldErrors.name && <span className="field-tip">{fieldErrors.name}</span>}
      </label>

      <label>
        性格特点
        <textarea value={draft.persona} onChange={(e) => set("persona", e.target.value)} rows={2}
          placeholder="犀利、爱抬杠、逻辑控……" />
      </label>

      <label>
        语言特色 / 口头禅
        <textarea value={draft.languageStyle} onChange={(e) => set("languageStyle", e.target.value)} rows={2}
          placeholder="说话简短、爱用反问、口头禅“讲白了”……" />
      </label>

      <label>
        观点阵营 / 立场
        <input value={draft.faction} onChange={(e) => set("faction", e.target.value)}
          placeholder="技术乐观派 / 保守谨慎派……" />
      </label>

      <label>
        过往经历
        <textarea
          value={draft.backstory}
          onChange={(e) => set("backstory", e.target.value)}
          rows={3}
          placeholder="出身、职业转折、关键经历……会影响说话视角与举例方式"
          className={fieldErrors.backstory ? "invalid" : undefined}
          aria-invalid={Boolean(fieldErrors.backstory)}
        />
        {fieldErrors.backstory && <span className="field-tip">{fieldErrors.backstory}</span>}
      </label>

      <label>
        头像图片
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "6px" }}>
          <input
            value={draft.avatar}
            onChange={(e) => set("avatar", e.target.value)}
            placeholder="粘贴头像 URL 或在右侧上传本地图片"
            style={{ margin: 0, flex: 1 }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => document.getElementById("avatar-upload-input")?.click()}
            style={{ flex: "none", padding: "10px 14px", height: "42px" }}
          >
            {uploading ? "上传中..." : "📁 本地上传"}
          </button>
          <input
            id="avatar-upload-input"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarUpload}
          />
        </div>
        {uploadError && <span className="error" style={{ display: "block", marginTop: "4px" }}>{uploadError}</span>}
      </label>

      <div className="row">
        <label className="grow">
          音色 ID（Fish reference_id）
          <input value={draft.voiceId} onChange={(e) => set("voiceId", e.target.value)}
            placeholder="从 fish.audio 后台复制" />
        </label>
        <label className="narrow">
          语速
          <div className="number-stepper">
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={2}
              value={draft.speed}
              onChange={(e) => set("speed", Number(e.target.value) || 1)}
            />
            <div className="number-stepper-btns" aria-hidden="true">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => set("speed", Math.min(2, Math.round((draft.speed + 0.05) * 100) / 100))}
              >
                <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor"><path d="M5 0L10 6H0z" /></svg>
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => set("speed", Math.max(0.5, Math.round((draft.speed - 0.05) * 100) / 100))}
              >
                <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor"><path d="M0 0h10L5 6z" /></svg>
              </button>
            </div>
          </div>
        </label>
      </div>

      <label>
        默认情感基调（可选）
        <input value={draft.defaultEmotion} onChange={(e) => set("defaultEmotion", e.target.value)}
          placeholder="平静 / 热情 / 冷峻……" />
      </label>

      <div className="actions split">
        {!editing ? (
          <button
            type="button"
            className="form-clear"
            onClick={() => {
              setDraft(EMPTY);
              setUploadError(null);
              setPolishError(null);
              setFieldErrors({});
              onClear?.();
            }}
          >
            清空
          </button>
        ) : (
          <span />
        )}
        <div className="actions-right">
          <button
            type="button"
            className={"ai-polish" + (polishing ? " loading" : "")}
            onClick={handlePolish}
            disabled={!canPolish}
            title="根据已填内容润色并补全（不含头像与音色）"
          >
            {polishing ? "润色中…" : "AI 润色"}
          </button>
          {editing && (
            <button type="button" onClick={onCancel}>
              取消
            </button>
          )}
          <button type="submit" className="primary wide">
            {editing ? "保存" : "创建"}
          </button>
        </div>
      </div>
    </form>
  );
}

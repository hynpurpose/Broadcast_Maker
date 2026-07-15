import { useEffect, useState } from "react";
import type { Character, CharacterDraft } from "../types";
import { api } from "../api";

const EMPTY: CharacterDraft = {
  name: "",
  persona: "",
  languageStyle: "",
  faction: "",
  voiceId: "",
  speed: 1,
  defaultEmotion: "",
  avatar: "",
};

export function CharacterForm({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: Character | null;
  onSubmit: (draft: CharacterDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CharacterDraft>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    } else {
      setDraft(EMPTY);
    }
  }, [editing]);

  function set<K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        onSubmit(draft);
      }}
    >
      <h2>{editing ? "编辑角色" : "新建角色"}</h2>

      <label>
        角色名
        <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="例如：老陈" />
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

      <div className="actions">
        <button type="submit" className="primary">{editing ? "保存" : "创建"}</button>
        {editing && <button type="button" onClick={onCancel}>取消</button>}
      </div>
    </form>
  );
}

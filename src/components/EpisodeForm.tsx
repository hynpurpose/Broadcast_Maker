import { useEffect, useState } from "react";
import type { Character, Episode, EpisodeDraft, SearchMode } from "../types";
import { SCRIPT_MODELS, DEFAULT_MODEL, SEARCH_MODES, DEFAULT_SEARCH_MODE } from "../constants";
import { Select } from "./Select";

const EMPTY: EpisodeDraft = {
  title: "",
  topic: "",
  materials: "",
  materialLinks: "",
  durationMinutes: 10,
  hostId: "",
  guestIds: [],
  model: DEFAULT_MODEL,
  searchMode: DEFAULT_SEARCH_MODE,
  searchBrief: "",
  basedOnEpisodeIds: [],
};

function resolveSearchMode(e: Episode & { searchEnabled?: boolean }): SearchMode {
  if (e.searchMode) return e.searchMode;
  return e.searchEnabled ? "google" : "off";
}

export function EpisodeForm({
  editing,
  characters,
  episodes,
  onSubmit,
  onCancel,
}: {
  editing: Episode | null;
  characters: Character[];
  episodes: Episode[];
  onSubmit: (draft: EpisodeDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EpisodeDraft>(EMPTY);

  useEffect(() => {
    if (editing) {
      const { title, topic, materials, durationMinutes, hostId, guestIds, model } = editing;
      setDraft({
        title,
        topic,
        materials,
        materialLinks: editing.materialLinks || "",
        durationMinutes,
        hostId,
        guestIds,
        model: model || DEFAULT_MODEL,
        searchMode: resolveSearchMode(editing),
        searchBrief: editing.searchBrief || "",
        basedOnEpisodeIds: editing.basedOnEpisodeIds || [],
      });
    } else {
      setDraft(EMPTY);
    }
  }, [editing]);

  function toggleBasedOn(id: string) {
    setDraft((d) => ({
      ...d,
      basedOnEpisodeIds: d.basedOnEpisodeIds.includes(id)
        ? d.basedOnEpisodeIds.filter((x) => x !== id)
        : [...d.basedOnEpisodeIds, id],
    }));
  }

  // Episodes that already have a script and aren't the one being edited.
  const priorOptions = episodes.filter((e) => e.script && e.id !== editing?.id);

  function set<K extends keyof EpisodeDraft>(key: K, value: EpisodeDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleGuest(id: string) {
    setDraft((d) => ({
      ...d,
      guestIds: d.guestIds.includes(id) ? d.guestIds.filter((g) => g !== id) : [...d.guestIds, id],
    }));
  }

  const estWords = draft.durationMinutes * 300;

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <h2>{editing ? "编辑节目" : "新建节目"}</h2>

      <label>
        节目标题（可留空，让 AI 起）
        <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="可选" />
      </label>

      <label>
        联网搜索（生成前用 Gemini 搜资料，作为创作素材）
        <Select
          value={draft.searchMode}
          onChange={(val) => set("searchMode", val as SearchMode)}
          options={SEARCH_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </label>

      {draft.searchMode !== "off" && (
        <label>
          调研需求（可选，写清想查什么、关注角度、时效等）
          <textarea
            value={draft.searchBrief}
            onChange={(e) => set("searchBrief", e.target.value)}
            rows={2}
            placeholder="例：重点查近一年进展、主要争议、对普通人的影响；不要只堆技术参数"
          />
        </label>
      )}

      <label>
        主题
        <textarea value={draft.topic} onChange={(e) => set("topic", e.target.value)} rows={2}
          placeholder="本期要聊什么（尽量具体：对象 + 角度）" />
      </label>

      <label>
        参考材料（文字要点、数据、观点等）
        <textarea value={draft.materials} onChange={(e) => set("materials", e.target.value)} rows={4}
          placeholder="粘贴要点、数据、事实、观点素材……" />
      </label>

      <label>
        参考链接（每行一个，写稿前自动抓取正文）
        <textarea
          value={draft.materialLinks}
          onChange={(e) => set("materialLinks", e.target.value)}
          rows={3}
          placeholder={"https://example.com/article\nhttps://www.reddit.com/r/.../comments/..."}
        />
      </label>

      {priorOptions.length > 0 && (
        <fieldset className="guests">
          <legend>基于往期节目（延续/呼应，可多选）</legend>
          {priorOptions.map((e) => (
            <label key={e.id} className="checkbox">
              <input type="checkbox" checked={draft.basedOnEpisodeIds.includes(e.id)}
                onChange={() => toggleBasedOn(e.id)} />
              {e.title || "（未命名）"}
            </label>
          ))}
        </fieldset>
      )}

      <div className="row">
        <label className="narrow">
          时长（分钟）
          <input type="number" min={1} max={120} value={draft.durationMinutes}
            onChange={(e) => set("durationMinutes", Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <div className="grow est">≈ {estWords} 字</div>
      </div>

      <label>
        主持人
        <Select
          value={draft.hostId}
          onChange={(val) => set("hostId", val)}
          options={[
            { value: "", label: "— 选择主持人 —" },
            ...characters.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </label>

      <fieldset className="guests">
        <legend>嘉宾（可多选）</legend>
        {characters.length === 0 && <p className="muted small">先去「角色库」创建角色。</p>}
        {characters.map((c) => (
          <label key={c.id} className="checkbox" data-disabled={c.id === draft.hostId}>
            <input type="checkbox" checked={draft.guestIds.includes(c.id)}
              disabled={c.id === draft.hostId}
              onChange={() => toggleGuest(c.id)} />
            {c.name}
            {c.id === draft.hostId && <span className="muted small">（已是主持人）</span>}
          </label>
        ))}
      </fieldset>

      <label>
        写稿模型
        <Select
          value={draft.model}
          onChange={(val) => set("model", val)}
          options={SCRIPT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      </label>

      <div className="actions end">
        {editing && <button type="button" onClick={onCancel}>取消</button>}
        <button type="submit" className="primary wide">{editing ? "保存" : "创建"}</button>
      </div>
    </form>
  );
}

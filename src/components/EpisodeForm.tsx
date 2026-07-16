import { useEffect, useRef, useState } from "react";
import type {
  Character,
  Episode,
  EpisodeDraft,
  EpisodeMode,
  EpisodePolishField,
  SearchMode,
} from "../types";
import { EPISODE_MODES, DEFAULT_MODE, SCRIPT_MODELS, DEFAULT_MODEL, SEARCH_MODES, DEFAULT_SEARCH_MODE } from "../constants";
import { api } from "../api";
import { Select } from "./Select";
import { MaterialsField } from "./MaterialsField";

const EMPTY: EpisodeDraft = {
  title: "",
  mode: DEFAULT_MODE,
  topic: "",
  materials: "",
  materialLinks: "",
  durationMinutes: 10,
  hostId: "",
  guestIds: [],
  model: DEFAULT_MODEL,
  searchMode: DEFAULT_SEARCH_MODE,
  searchBrief: "",
  searchDone: false,
  searchSources: [],
  basedOnEpisodeIds: [],
  storyBackground: "",
  characterRelations: "",
  narratorId: "",
  leadActorIds: [],
  plotDevelopment: "",
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
  const [polishingField, setPolishingField] = useState<EpisodePolishField | null>(null);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchHint, setResearchHint] = useState<string | null>(null);
  const researchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (researchPollRef.current) clearInterval(researchPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (editing) {
      const { title, topic, materials, durationMinutes, hostId, guestIds, model } = editing;
      setDraft({
        title,
        mode: editing.mode || DEFAULT_MODE,
        topic,
        materials,
        materialLinks: editing.materialLinks || "",
        durationMinutes,
        hostId,
        guestIds,
        model: model || DEFAULT_MODEL,
        searchMode: resolveSearchMode(editing),
        searchBrief: editing.searchBrief || "",
        searchDone: Boolean(editing.searchDone),
        searchSources: editing.searchSources || [],
        basedOnEpisodeIds: editing.basedOnEpisodeIds || [],
        storyBackground: editing.storyBackground || "",
        characterRelations: editing.characterRelations || "",
        narratorId: editing.narratorId || "",
        leadActorIds: editing.leadActorIds || [],
        plotDevelopment: editing.plotDevelopment || "",
      });
    } else {
      setDraft(EMPTY);
    }
    setPolishError(null);
    setResearchError(null);
    setResearchHint(null);
  }, [editing]);

  function toggleBasedOn(id: string) {
    setDraft((d) => ({
      ...d,
      basedOnEpisodeIds: d.basedOnEpisodeIds.includes(id)
        ? d.basedOnEpisodeIds.filter((x) => x !== id)
        : [...d.basedOnEpisodeIds, id],
    }));
  }

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

  function toggleLeadActor(id: string) {
    setDraft((d) => ({
      ...d,
      leadActorIds: d.leadActorIds.includes(id)
        ? d.leadActorIds.filter((a) => a !== id)
        : [...d.leadActorIds, id],
    }));
  }

  const isSitcom = draft.mode === "sitcom";

  async function handlePolish(field: EpisodePolishField) {
    const value = String(draft[field] || "").trim();
    if (!value) return;
    setPolishError(null);
    setPolishingField(field);
    try {
      const result = await api.polishTopic({
        field,
        topic: draft.topic,
        storyBackground: draft.storyBackground,
        characterRelations: draft.characterRelations,
        plotDevelopment: draft.plotDevelopment,
        title: draft.title,
        materials: draft.materials,
        mode: draft.mode,
      });
      set(field, result.text);
    } catch (e) {
      setPolishError(String(e instanceof Error ? e.message : e));
    } finally {
      setPolishingField(null);
    }
  }

  function canPolish(field: EpisodePolishField) {
    return !polishingField && !researching && Boolean(String(draft[field] || "").trim());
  }

  function researchLabel() {
    if (!researching) {
      return draft.searchDone ? "重新调研" : "开始调研";
    }
    if (draft.searchMode === "deep_research_max") return "Deep Research Max 调研中…";
    if (draft.searchMode === "deep_research") return "Deep Research 调研中…";
    return "搜索并总结中…";
  }

  async function handleResearch() {
    if (draft.searchMode === "off" || researching) return;
    setResearchError(null);
    setResearchHint(null);
    setResearching(true);
    try {
      const { jobId } = await api.startResearch({
        title: draft.title,
        topic: draft.topic,
        searchBrief: draft.searchBrief,
        materials: draft.materials,
        materialLinks: draft.materialLinks,
        searchMode: draft.searchMode,
        mode: draft.mode,
        storyBackground: draft.storyBackground,
        characterRelations: draft.characterRelations,
        plotDevelopment: draft.plotDevelopment,
      });

      if (researchPollRef.current) clearInterval(researchPollRef.current);
      await new Promise<void>((resolve, reject) => {
        const tick = async () => {
          try {
            const p = await api.getResearchProgress(jobId);
            if (p.phase === "done") {
              if (researchPollRef.current) clearInterval(researchPollRef.current);
              researchPollRef.current = null;
              setDraft((d) => ({
                ...d,
                materials: p.materials ?? d.materials,
                materialLinks: p.materialLinks ?? d.materialLinks,
                searchSources: p.searchSources || [],
                searchDone: true,
              }));
              const isDeep =
                draft.searchMode === "deep_research" || draft.searchMode === "deep_research_max";
              setResearchHint(
                isDeep
                  ? "调研完成：报告已写入参考材料，链接已写入参考链接。创建/生成时不会再重新搜索。"
                  : "调研完成：搜索结果已总结进参考材料。创建/生成时不会再重新搜索。"
              );
              resolve();
            } else if (p.phase === "error") {
              if (researchPollRef.current) clearInterval(researchPollRef.current);
              researchPollRef.current = null;
              reject(new Error(p.error || "调研失败"));
            }
          } catch (e) {
            if (researchPollRef.current) clearInterval(researchPollRef.current);
            researchPollRef.current = null;
            reject(e);
          }
        };
        void tick();
        researchPollRef.current = setInterval(tick, 2000);
      });
    } catch (e) {
      setResearchError(String(e instanceof Error ? e.message : e));
    } finally {
      setResearching(false);
    }
  }

  const estWords = draft.durationMinutes * 300;

  function PolishButton({ field, title }: { field: EpisodePolishField; title: string }) {
    const busy = polishingField === field;
    return (
      <button
        type="button"
        className={"ai-polish compact" + (busy ? " loading" : "")}
        onClick={() => handlePolish(field)}
        disabled={!canPolish(field)}
        title={title}
      >
        {busy ? "润色中…" : "AI 润色"}
      </button>
    );
  }

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <h2>{editing ? "编辑节目" : "新建节目"}</h2>

      {polishError && <p className="error">⚠ {polishError}</p>}
      {researchError && <p className="error">⚠ {researchError}</p>}
      {researchHint && <p className="muted small">{researchHint}</p>}

      <label>
        节目模式
        <Select
          value={draft.mode}
          onChange={(val) => set("mode", val as EpisodeMode)}
          options={EPISODE_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </label>

      <label>
        节目标题（可留空，让 AI 起）
        <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="可选" />
      </label>

      <label>
        联网搜索（生成前用 Gemini 搜资料，作为创作素材）
        <Select
          value={draft.searchMode}
          onChange={(val) => {
            const mode = val as SearchMode;
            setDraft((d) => ({
              ...d,
              searchMode: mode,
              // Changing mode invalidates prior research for generate-skip purposes.
              searchDone: mode === "off" ? false : d.searchDone && mode === d.searchMode,
            }));
            setResearchHint(null);
          }}
          options={SEARCH_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </label>

      {draft.searchMode !== "off" && (
        <>
          <label>
            调研需求（可选，写清想查什么、关注角度、时效等）
            <textarea
              value={draft.searchBrief}
              onChange={(e) => set("searchBrief", e.target.value)}
              rows={2}
              placeholder="例：重点查近一年进展、主要争议、对普通人的影响；不要只堆技术参数"
            />
          </label>
          <div className="research-actions">
            <button
              type="button"
              className="primary"
              onClick={handleResearch}
              disabled={researching || Boolean(polishingField)}
            >
              {researchLabel()}
            </button>
            {draft.searchDone && (
              <span className="muted small">已调研 · 创建后生成脚本时不会再重新搜索</span>
            )}
          </div>
        </>
      )}

      {isSitcom ? (
        <>
          <div className="field-block">
            <div className="field-head">
              <span>故事背景</span>
              <PolishButton field="storyBackground" title="润色已写好的故事背景（保留原意，写得更具体）" />
            </div>
            <textarea
              value={draft.storyBackground}
              onChange={(e) => {
                set("storyBackground", e.target.value);
                if (polishError) setPolishError(null);
              }}
              rows={3}
              placeholder="时代、地点、世界观、外部情境……"
            />
          </div>

          <div className="field-block">
            <div className="field-head">
              <span>人物关系</span>
              <PolishButton field="characterRelations" title="润色已写好的人物关系（保留原意，写得更清楚）" />
            </div>
            <textarea
              value={draft.characterRelations}
              onChange={(e) => {
                set("characterRelations", e.target.value);
                if (polishError) setPolishError(null);
              }}
              rows={3}
              placeholder="谁和谁是什么关系、矛盾点、羁绊……"
            />
          </div>

          <div className="field-block">
            <div className="field-head">
              <span>情节发展</span>
              <PolishButton field="plotDevelopment" title="润色已写好的情节（保留原意，写得更具体）" />
            </div>
            <textarea
              value={draft.plotDevelopment}
              onChange={(e) => {
                set("plotDevelopment", e.target.value);
                if (polishError) setPolishError(null);
              }}
              rows={4}
              placeholder="本集要发生什么：起因 → 冲突 → 转折 → 收束"
            />
          </div>

          <div className="field-block">
            <div className="field-head">
              <span>本集主题（可选，一句话概括）</span>
              <PolishButton field="topic" title="润色已写好的本集主题（保留原意，写得更具体）" />
            </div>
            <textarea
              value={draft.topic}
              onChange={(e) => {
                set("topic", e.target.value);
                if (polishError) setPolishError(null);
              }}
              rows={2}
              placeholder="例：旧友重逢后的一次试探与和解"
            />
          </div>
        </>
      ) : (
        <div className="field-block">
          <div className="field-head">
            <span>主题</span>
            <PolishButton field="topic" title="润色已写好的主题（保留原意，写得更具体）" />
          </div>
          <textarea
            value={draft.topic}
            onChange={(e) => {
              set("topic", e.target.value);
              if (polishError) setPolishError(null);
            }}
            rows={2}
            placeholder="本期要聊什么（尽量具体：对象 + 角度）"
          />
        </div>
      )}

      <MaterialsField
        value={draft.materials}
        onChange={(v) => set("materials", v)}
        rows={6}
        placeholder="粘贴要点、数据、事实、观点素材……也可点上方「开始调研」自动填入"
      />

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
              <input
                type="checkbox"
                checked={draft.basedOnEpisodeIds.includes(e.id)}
                onChange={() => toggleBasedOn(e.id)}
              />
              {e.title || "（未命名）"}
              {(e.mode || "podcast") === "sitcom" ? " · 情景剧" : ""}
            </label>
          ))}
        </fieldset>
      )}

      <div className="row">
        <label className="narrow">
          时长（分钟）
          <input
            type="number"
            min={1}
            max={120}
            value={draft.durationMinutes}
            onChange={(e) => set("durationMinutes", Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <div className="grow est">≈ {estWords} 字</div>
      </div>

      {isSitcom ? (
        <>
          <label>
            旁白 / 主讲人
            <Select
              value={draft.narratorId}
              onChange={(val) => set("narratorId", val)}
              options={[
                { value: "", label: "— 选择旁白 —" },
                ...characters.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </label>

          <fieldset className="guests">
            <legend>主演（可多选）</legend>
            {characters.length === 0 && <p className="muted small">先去「角色库」创建角色。</p>}
            <div className="guest-grid">
              {characters.map((c) => (
                <label key={c.id} className="checkbox" data-disabled={c.id === draft.narratorId}>
                  <input
                    type="checkbox"
                    checked={draft.leadActorIds.includes(c.id)}
                    disabled={c.id === draft.narratorId}
                    onChange={() => toggleLeadActor(c.id)}
                  />
                  {c.name}
                  {c.id === draft.narratorId && <span className="muted small">（已是旁白）</span>}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <>
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
            <div className="guest-grid">
              {characters.map((c) => (
                <label key={c.id} className="checkbox" data-disabled={c.id === draft.hostId}>
                  <input
                    type="checkbox"
                    checked={draft.guestIds.includes(c.id)}
                    disabled={c.id === draft.hostId}
                    onChange={() => toggleGuest(c.id)}
                  />
                  {c.name}
                  {c.id === draft.hostId && <span className="muted small">（已是主持人）</span>}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      <label>
        写稿模型
        <Select
          value={draft.model}
          onChange={(val) => set("model", val)}
          options={SCRIPT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      </label>

      <div className="actions end">
        {editing && (
          <button type="button" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className="primary wide" disabled={researching || Boolean(polishingField)}>
          {editing ? "保存" : "创建"}
        </button>
      </div>
    </form>
  );
}

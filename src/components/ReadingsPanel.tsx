import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Character, Episode, Reading, ReadingDraft, ReadingGenProgress } from "../types";
import {
  DEFAULT_MODEL,
  DEFAULT_READING_LANGUAGE,
  READING_LANGUAGES,
  SCRIPT_MODELS,
} from "../constants";
import { api } from "../api";
import { Select } from "./Select";
import { PodcastPlayer } from "./PodcastPlayer";
import { ConfirmDialog } from "./ConfirmDialog";

const EMPTY: ReadingDraft = {
  title: "",
  articleText: "",
  articleUrl: "",
  articleLanguage: DEFAULT_READING_LANGUAGE,
  readerId: "",
  explainerId: "",
  explainerLanguage: "zh",
  model: DEFAULT_MODEL,
};

const langLabel = (id: string) =>
  READING_LANGUAGES.find((l) => l.id === id)?.label || id;

const modelLabel = (id: string) =>
  SCRIPT_MODELS.find((m) => m.id === id)?.label || SCRIPT_MODELS[0].label;

/** PodcastPlayer 只依赖 id / title / script，用 Reading 适配即可。 */
function asEpisode(r: Reading): Episode {
  return {
    id: r.id,
    title: r.title,
    mode: "podcast",
    topic: "",
    materials: r.articleText,
    materialLinks: r.articleUrl,
    durationMinutes: 10,
    hostId: r.readerId,
    guestIds: r.explainerId ? [r.explainerId] : [],
    model: r.model,
    searchMode: "off",
    searchBrief: "",
    basedOnEpisodeIds: [],
    storyBackground: "",
    characterRelations: "",
    narratorId: "",
    leadActorIds: [],
    plotDevelopment: "",
    status: r.status,
    script: r.script,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function ReadingForm({
  editing,
  characters,
  onSubmit,
  onCancel,
}: {
  editing: Reading | null;
  characters: Character[];
  onSubmit: (draft: ReadingDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ReadingDraft>(EMPTY);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setDraft({
        title: editing.title,
        articleText: editing.articleText,
        articleUrl: editing.articleUrl || "",
        articleLanguage: editing.articleLanguage || DEFAULT_READING_LANGUAGE,
        readerId: editing.readerId,
        explainerId: editing.explainerId,
        explainerLanguage: editing.explainerLanguage || "zh",
        model: editing.model || DEFAULT_MODEL,
      });
    } else {
      setDraft(EMPTY);
    }
    setExtractError(null);
  }, [editing]);

  function set<K extends keyof ReadingDraft>(key: K, value: ReadingDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleExtract() {
    const url = draft.articleUrl.trim();
    if (!url) {
      setExtractError("请先填写文章链接");
      return;
    }
    setExtracting(true);
    setExtractError(null);
    try {
      const result = await api.extractReadingArticle(url);
      setDraft((d) => ({
        ...d,
        title: d.title.trim() || result.title,
        articleText: result.articleText,
      }));
    } catch (e) {
      setExtractError(String(e instanceof Error ? e.message : e));
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.articleText.trim()) {
      setExtractError("请粘贴文章正文，或从链接提取");
      return;
    }
    if (!draft.readerId || !draft.explainerId) {
      setExtractError("请选择朗读者和讲解者");
      return;
    }
    if (draft.readerId === draft.explainerId) {
      setExtractError("朗读者和讲解者不能是同一人");
      return;
    }
    setSaving(true);
    setExtractError(null);
    try {
      await onSubmit({
        ...draft,
        title: draft.title.trim() || "文章精读",
      });
    } catch (err) {
      setExtractError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <div className="form-header">
        <h2>{editing ? "编辑精读" : "新建精读"}</h2>
        {editing && (
          <button type="button" className="form-clear" onClick={onCancel}>
            取消编辑
          </button>
        )}
      </div>

      <label>
        标题
        <input
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="可选，提取后可自动填充"
        />
      </label>

      <label>
        文章链接
        <div className="reading-url-row">
          <input
            value={draft.articleUrl}
            onChange={(e) => set("articleUrl", e.target.value)}
            placeholder="https://..."
          />
          <button type="button" onClick={handleExtract} disabled={extracting}>
            {extracting ? "提取中…" : "提取"}
          </button>
        </div>
      </label>

      <label>
        文章正文
        <textarea
          rows={12}
          value={draft.articleText}
          onChange={(e) => set("articleText", e.target.value)}
          placeholder="直接粘贴文章，或填写链接后点「提取」"
        />
      </label>

      <div className="row">
        <label>
          文章语言
          <Select
            value={draft.articleLanguage}
            onChange={(v) => set("articleLanguage", v)}
            options={READING_LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
          />
        </label>
        <label>
          讲解语言
          <Select
            value={draft.explainerLanguage}
            onChange={(v) => set("explainerLanguage", v)}
            options={READING_LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
          />
        </label>
      </div>

      <div className="row">
        <label>
          朗读者（用文章语言朗读）
          <Select
            value={draft.readerId}
            onChange={(v) => set("readerId", v)}
            options={[
              { value: "", label: "选择角色…" },
              ...characters.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </label>
        <label>
          讲解者
          <Select
            value={draft.explainerId}
            onChange={(v) => set("explainerId", v)}
            options={[
              { value: "", label: "选择角色…" },
              ...characters
                .filter((c) => c.id !== draft.readerId)
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </label>
      </div>

      <label>
        写稿模型
        <Select
          value={draft.model}
          onChange={(v) => set("model", v)}
          options={SCRIPT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      </label>

      {extractError && <p className="error">⚠ {extractError}</p>}

      <div className="actions">
        <button type="submit" className="primary" disabled={saving || characters.length < 2}>
          {saving ? "保存中…" : editing ? "保存修改" : "创建精读项目"}
        </button>
      </div>
      {characters.length < 2 && (
        <p className="muted small">至少需要两个角色（朗读者 + 讲解者）。</p>
      )}
    </form>
  );
}

export function ReadingsPanel({ characters }: { characters: Character[] }) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [editing, setEditing] = useState<Reading | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadingGenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const selected = readings.find((r) => r.id === selectedId) || null;

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    setGeneratingId(id);
    let nullStreak = 0;
    pollRef.current = setInterval(async () => {
      let p: ReadingGenProgress | null;
      try {
        p = await api.getReadingGenProgress(id);
      } catch {
        return;
      }
      if (!p) {
        nullStreak += 1;
        // Server restarted or job lost — stop fake "生成中…"
        if (nullStreak >= 3) {
          stopPolling();
          setGeneratingId(null);
          setProgress(null);
          setError("生成任务已中断（服务可能重启了），请重新点「生成精读稿」");
          await refresh();
        }
        return;
      }
      nullStreak = 0;
      if (p.phase === "done") {
        stopPolling();
        await refresh();
        setSelectedId(id);
        setGeneratingId(null);
        setProgress(null);
      } else if (p.phase === "error") {
        stopPolling();
        setError(p.error || p.message || "生成失败");
        setGeneratingId(null);
        setProgress(null);
        await refresh();
      } else {
        setProgress(p);
        // Refresh occasionally so mid-saved paragraphs/script appear
        if (p.phase === "script" && (p.current || 0) > 0 && (p.current || 0) % 4 === 0) {
          refresh().catch(() => {});
        }
      }
    }, 1500);
  }

  useEffect(() => () => stopPolling(), []);

  async function refresh() {
    setReadings(await api.listReadings());
  }
  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getReadingGenProgress(selectedId);
        if (cancelled || !p) return;
        if (p.phase === "split" || p.phase === "script") {
          setProgress(p);
          startPolling(selectedId);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleSubmit(draft: ReadingDraft) {
    if (editing) {
      const updated = await api.updateReading(editing.id, draft);
      setEditing(null);
      await refresh();
      setSelectedId(updated.id);
    } else {
      const created = await api.createReading(draft);
      await refresh();
      setSelectedId(created.id);
      await handleGenerate(created.id, false);
    }
  }

  async function handleGenerate(id: string, force: boolean) {
    setError(null);
    try {
      const result = await api.startReadingGenerate(id, { force });
      if (result.busy && result.progress) setProgress(result.progress);
      startPolling(id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  function requestDelete(id: string) {
    const r = readings.find((x) => x.id === id);
    setPendingDelete({ id, title: r?.title?.trim() || "该精读项目" });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    await api.deleteReading(id);
    if (selectedId === id) setSelectedId(null);
    if (editing?.id === id) setEditing(null);
    if (generatingId === id) {
      stopPolling();
      setGeneratingId(null);
      setProgress(null);
    }
    await refresh();
  }

  function progressText(p: ReadingGenProgress | null) {
    if (!p) return "连接生成任务…";
    if (p.message) return p.message;
    if (p.phase === "split") return "按意群拆段中…";
    if (p.phase === "script") {
      if (p.total) return `写精读稿…${p.current ?? 0}/${p.total} 段`;
      return "写精读稿…";
    }
    return "生成中…";
  }

  function progressPercent(p: ReadingGenProgress | null) {
    if (!p) return 5;
    if (p.phase === "split") return 8;
    if (p.phase === "script" && p.total) {
      return Math.min(95, 10 + Math.round(((p.current || 0) / p.total) * 85));
    }
    if (p.phase === "done") return 100;
    return 12;
  }

  async function handleSaveSegment(readingId: string, index: number, patch: { text: string; emotion: string }) {
    const updated = await api.updateReadingSegment(readingId, index, patch);
    setReadings((list) => list.map((r) => (r.id === updated.id ? updated : r)));
  }

  function selectReading(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="col">
      <div className="layout">
        <section className="col">
          <ReadingForm
            editing={editing}
            characters={characters}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />

          <div className="card">
            <div className="ep-deck-head" style={{ marginBottom: 12 }}>
              <div className="ep-deck-title">精读库</div>
              <div className="ep-deck-count">{readings.length} 项</div>
            </div>
            {readings.length === 0 && (
              <p className="muted">还没有精读项目，先在上方创建。</p>
            )}
            <div className="episode-list">
              {readings.map((r) => {
                const isSelected = r.id === selectedId;
                const isReady = r.status === "script_ready";
                const dateStr = new Date(r.createdAt || Date.now()).toLocaleDateString("zh-CN", {
                  month: "short",
                  day: "numeric",
                });
                return (
                  <div
                    key={r.id}
                    className={"episode-card" + (isSelected ? " active" : "")}
                    onClick={() => selectReading(r.id)}
                  >
                    <div className="ep-duration" title={`${langLabel(r.articleLanguage)} → ${langLabel(r.explainerLanguage)}`}>
                      <span className="ep-duration-value" style={{ fontSize: 13 }}>
                        {langLabel(r.articleLanguage)}
                      </span>
                      <span className="ep-duration-unit">原文</span>
                    </div>
                    <div className="ep-info">
                      <div className="ep-info-top">
                        <span className={"ep-card-status " + (isReady ? "ready" : "draft")}>
                          {isReady ? "就绪" : "草稿"}
                        </span>
                        <h3 className="ep-title">{r.title || "（未命名精读）"}</h3>
                      </div>
                      <div className="ep-meta">
                        <span className="ep-meta-item">讲 {langLabel(r.explainerLanguage)}</span>
                        <span className="ep-meta-item">{modelLabel(r.model).split("（")[0]}</span>
                        <span className="ep-meta-item date">{dateStr}</span>
                      </div>
                    </div>
                    <div className="ep-actions" onClick={(ev) => ev.stopPropagation()}>
                      <button type="button" className="ghost" onClick={() => setEditing(r)}>
                        编辑
                      </button>
                      <button type="button" className="danger" onClick={() => requestDelete(r.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="col">
          <div className="card episode-script-card" ref={detailRef}>
            {selected ? (
              <div className="episode-detail-bar">
                <h2 className="episode-detail-title">{selected.title || "（未命名精读）"}</h2>
                <button type="button" className="episode-detail-edit" onClick={() => setEditing(selected)}>
                  编辑
                </button>
              </div>
            ) : (
              <h2>精读脚本</h2>
            )}
            {!selected && <p className="muted">从左侧精读库选择一项，或新建后自动开始生成。</p>}
            {selected && (
              <>
                <div className="gen-row">
                  <button
                    className="primary"
                    onClick={() => handleGenerate(selected.id, false)}
                    disabled={generatingId === selected.id}
                  >
                    {generatingId === selected.id
                      ? progressText(progress)
                      : selected.script
                      ? "↻ 重新生成精读稿"
                      : "✦ 生成精读稿"}
                  </button>
                  {selected.script && generatingId !== selected.id && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("将清空当前精读稿并重新生成？")) {
                          handleGenerate(selected.id, true);
                        }
                      }}
                    >
                      从头重来
                    </button>
                  )}
                  <span className="muted small">
                    {modelLabel(selected.model)} · {langLabel(selected.articleLanguage)} →{" "}
                    {langLabel(selected.explainerLanguage)}
                    {selected.paragraphs?.length
                      ? ` · ${selected.paragraphs.length} 个意群`
                      : ""}
                  </span>
                </div>
                {error && <p className="error">⚠ {error}</p>}
                {generatingId === selected.id && (
                  <div className="reading-progress">
                    <div className="reading-progress-label">{progressText(progress)}</div>
                    <div className="reading-progress-track">
                      <div
                        className="reading-progress-bar"
                        style={{ width: `${progressPercent(progress)}%` }}
                      />
                    </div>
                    {progress?.total ? (
                      <div className="muted small">
                        {progress.current ?? 0} / {progress.total} 意群
                      </div>
                    ) : null}
                  </div>
                )}
                {selected.script ? (
                  <PodcastPlayer
                    episode={asEpisode(selected)}
                    characters={characters}
                    onSaveSegment={(index, patch) => handleSaveSegment(selected.id, index, patch)}
                  />
                ) : (
                  <p className="muted">
                    {generatingId === selected.id
                      ? "生成完成后会在这里出现播放器。"
                      : "还没有精读稿。确认文章与角色后点「生成精读稿」。"}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="删除精读"
          message={`确定删除精读「${pendingDelete.title}」？此操作不可撤销。`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

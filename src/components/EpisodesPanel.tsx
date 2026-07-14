import { useEffect, useState } from "react";
import type { Character, Episode, EpisodeDraft, GenProgress, SearchMode } from "../types";
import { api } from "../api";
import { SCRIPT_MODELS, SEARCH_MODES } from "../constants";
import { EpisodeForm } from "./EpisodeForm";
import { PodcastPlayer } from "./PodcastPlayer";

const modelLabel = (id: string) =>
  SCRIPT_MODELS.find((m) => m.id === id)?.label || SCRIPT_MODELS[0].label;

function episodeSearchMode(e: Episode & { searchEnabled?: boolean }): SearchMode {
  if (e.searchMode) return e.searchMode;
  return e.searchEnabled ? "google" : "off";
}

const searchModeLabel = (mode: SearchMode) =>
  SEARCH_MODES.find((m) => m.id === mode)?.label || mode;

function searchBadge(mode: SearchMode): string | null {
  if (mode === "off") return null;
  if (mode === "google") return "🌐 Google Search";
  if (mode === "deep_research") return "🔬 Deep Research";
  return "🔬 Deep Research Max";
}

export function EpisodesPanel({ characters }: { characters: Character[] }) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [editing, setEditing] = useState<Episode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setEpisodes(await api.listEpisodes());
  }
  useEffect(() => {
    refresh();
  }, []);

  const selected = episodes.find((e) => e.id === selectedId) || null;

  async function handleSubmit(draft: EpisodeDraft) {
    if (editing) {
      const updated = await api.updateEpisode(editing.id, draft);
      setEditing(null);
      setSelectedId(updated.id);
    } else {
      const created = await api.createEpisode(draft);
      setSelectedId(created.id);
    }
    refresh();
  }

  async function handleDelete(id: string) {
    await api.deleteEpisode(id);
    if (selectedId === id) setSelectedId(null);
    if (editing?.id === id) setEditing(null);
    refresh();
  }

  async function handleGenerate(id: string) {
    setError(null);
    setGeneratingId(id);
    setProgress({ phase: "search" });
    try {
      await api.startGenerate(id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setGeneratingId(null);
      setProgress(null);
      return;
    }
    // Poll until the background job reports done or error.
    const poll = setInterval(async () => {
      let p: GenProgress | null;
      try {
        p = await api.getGenProgress(id);
      } catch {
        return; // transient; keep polling
      }
      if (!p) return;
      if (p.phase === "done") {
        clearInterval(poll);
        await refresh();
        setSelectedId(id);
        setGeneratingId(null);
        setProgress(null);
      } else if (p.phase === "error") {
        clearInterval(poll);
        setError(p.error || "生成失败");
        setGeneratingId(null);
        setProgress(null);
      } else {
        setProgress(p);
      }
    }, 1500);
  }

  function progressText(p: GenProgress | null, mode?: SearchMode): string {
    if (!p) return "生成中…";
    if (p.phase === "search") {
      if (mode === "deep_research") return "Deep Research 调研中…";
      if (mode === "deep_research_max") return "Deep Research Max 调研中…";
      if (mode === "google") return "Google Search 搜索中…";
      return "联网搜索资料中…";
    }
    if (p.phase === "outline") return `构思分环节大纲中…（共 ${p.total ?? "?"} 段）`;
    if (p.phase === "section") return `逐段生成中…第 ${p.current}/${p.total} 段`;
    return "生成中…";
  }

  async function handleSaveSegment(episodeId: string, index: number, patch: { text: string; emotion: string }) {
    const updated = await api.updateSegment(episodeId, index, patch);
    setEpisodes((list) => list.map((e) => (e.id === updated.id ? updated : e)));
  }

  return (
    <div className="layout">
      <section className="col">
        <EpisodeForm
          editing={editing}
          characters={characters}
          episodes={episodes}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(null)}
        />

        <div className="card">
          <h2>节目列表（{episodes.length}）</h2>
          {episodes.length === 0 && <p className="muted">还没有节目，先新建一期。</p>}
          <div className="episode-list">
            {episodes.map((e) => {
              const isSelected = e.id === selectedId;
              const isReady = e.status === "script_ready";
              const badge = searchBadge(episodeSearchMode(e));
              const dateStr = new Date(e.createdAt || Date.now()).toLocaleDateString("zh-CN", {
                month: "short",
                day: "numeric"
              });

              return (
                <div
                  key={e.id}
                  className={"episode-card" + (isSelected ? " active" : "")}
                  onClick={() => setSelectedId(e.id)}
                >
                  {/* Left badge */}
                  <div className={"ep-badge " + (isReady ? "ready" : "draft")}>
                    <span className="ep-badge-status">{isReady ? "READY" : "DRAFT"}</span>
                    <span className="ep-badge-duration">{e.durationMinutes}</span>
                    <span className="ep-badge-unit">MINS</span>
                  </div>

                  {/* Center info */}
                  <div className="ep-info">
                    <h3 className="ep-title">{e.title || "（未命名节目）"}</h3>
                    <p className="ep-topic">{e.topic || "暂无主题描述"}</p>
                    <div className="ep-meta">
                      <span className="ep-meta-item">
                        🤖 {e.model === "claude-opus-4-8" ? "Opus" : "Sonnet"}
                      </span>
                      <span className="ep-meta-item">
                        👥 嘉宾 {e.guestIds.length} 位
                      </span>
                      {badge && (
                        <span className="ep-meta-item">
                          {badge}
                        </span>
                      )}
                      <span className="ep-meta-item date">
                        📅 {dateStr}
                      </span>
                    </div>
                  </div>

                  {/* Right actions */}
                  <div className="ep-actions" onClick={(ev) => ev.stopPropagation()}>
                    <button className={isSelected ? "primary" : ""} onClick={() => setEditing(e)}>
                      编辑
                    </button>
                    <button className="danger" onClick={() => handleDelete(e.id)}>
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
        <div className="card">
          <h2>脚本</h2>
          {!selected && <p className="muted">从左侧选择一期节目。</p>}
          {selected && (
            <>
              <div className="gen-row">
                <button
                  className="primary"
                  onClick={() => handleGenerate(selected.id)}
                  disabled={generatingId === selected.id}
                >
                  {generatingId === selected.id
                    ? progressText(progress, episodeSearchMode(selected))
                    : selected.script
                    ? "↻ 重新生成脚本"
                    : "✦ 生成脚本"}
                </button>
                <span className="muted small">
                  {modelLabel(selected.model)}
                  {episodeSearchMode(selected) !== "off" &&
                    ` · ${searchModeLabel(episodeSearchMode(selected))}`}
                </span>
              </div>
              {error && <p className="error">⚠ {error}</p>}
              {selected.searchSources && selected.searchSources.length > 0 && (
                <div className="sources">
                  <div className="muted small">参考来源（Gemini 联网）：</div>
                  <ul>
                    {selected.searchSources.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selected.script ? (
                <PodcastPlayer
                  episode={selected}
                  characters={characters}
                  onSaveSegment={(index, patch) => handleSaveSegment(selected.id, index, patch)}
                />
              ) : (
                <p className="muted">还没有脚本。指定好主持人和至少一位嘉宾后点「生成脚本」。</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

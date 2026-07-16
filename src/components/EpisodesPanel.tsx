import { useEffect, useState, useRef } from "react";
import type { Character, Episode, EpisodeDraft, GenProgress, SearchMode } from "../types";
import { api } from "../api";
import { SCRIPT_MODELS, SEARCH_MODES } from "../constants";
import { EpisodeForm } from "./EpisodeForm";
import { PodcastPlayer } from "./PodcastPlayer";
import { ConfirmDialog } from "./ConfirmDialog";
import { SourcesBlock } from "./SourcesBlock";
import {
  EpisodeLibrary,
  episodeSearchMode,
  hasResumableCheckpoint,
  checkpointHint,
} from "./EpisodeLibrary";

const modelLabel = (id: string) =>
  SCRIPT_MODELS.find((m) => m.id === id)?.label || SCRIPT_MODELS[0].label;

const searchModeLabel = (mode: SearchMode) =>
  SEARCH_MODES.find((m) => m.id === mode)?.label || mode;

export function EpisodesPanel({ characters }: { characters: Character[] }) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [editing, setEditing] = useState<Episode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    setGeneratingId(id);
    pollRef.current = setInterval(async () => {
      let p: GenProgress | null;
      try {
        p = await api.getGenProgress(id);
      } catch {
        return;
      }
      if (!p) return;
      if (p.phase === "done") {
        stopPolling();
        await refresh();
        setSelectedId(id);
        setGeneratingId(null);
        setProgress(null);
      } else if (p.phase === "error") {
        stopPolling();
        setError(p.error || "生成失败");
        setGeneratingId(null);
        setProgress(null);
        await refresh();
      } else {
        setProgress(p);
      }
    }, 1500);
  }

  useEffect(() => () => stopPolling(), []);

  async function refresh() {
    setEpisodes(await api.listEpisodes());
  }
  useEffect(() => {
    refresh();
  }, []);

  // Re-attach to an in-flight server job when selecting an episode.
  useEffect(() => {
    if (!selectedId || generatingId === selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getGenProgress(selectedId);
        if (cancelled || !p) return;
        if (p.phase !== "done" && p.phase !== "error") {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when selection changes
  }, [selectedId]);

  const selected = episodes.find((e) => e.id === selectedId) || null;
  const selectedIndex = selected ? episodes.findIndex((e) => e.id === selected.id) : -1;
  const prevEpisode = selectedIndex > 0 ? episodes[selectedIndex - 1] : null;
  const nextEpisode =
    selectedIndex >= 0 && selectedIndex < episodes.length - 1 ? episodes[selectedIndex + 1] : null;

  async function handleSubmit(draft: EpisodeDraft) {
    if (editing) {
      const updated = await api.updateEpisode(editing.id, draft);
      setEditing(null);
      selectEpisode(updated.id);
    } else {
      const created = await api.createEpisode(draft);
      selectEpisode(created.id);
    }
    refresh();
  }

  function requestDelete(id: string) {
    const ep = episodes.find((x) => x.id === id);
    setPendingDelete({ id, title: ep?.title?.trim() || "未命名节目" });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    await api.deleteEpisode(id);
    if (selectedId === id) {
      setSelectedId(null);
      setLibraryOpen(false);
    }
    if (editing?.id === id) setEditing(null);
    if (generatingId === id) {
      stopPolling();
      setGeneratingId(null);
      setProgress(null);
    }
    refresh();
  }

  async function handleGenerate(id: string, force = false) {
    setError(null);
    setGeneratingId(id);
    const ep = episodes.find((x) => x.id === id);
    const cp = ep?.genCheckpoint;
    setProgress(
      cp?.outline
        ? {
            phase: "section",
            current: Math.min((cp.nextSectionIndex || 0) + 1, cp.sectionCount || 1),
            total: cp.sectionCount,
          }
        : { phase: "search" }
    );
    try {
      const result = await api.startGenerate(id, { force });
      if (result.busy && result.progress) {
        setProgress(result.progress);
      }
      startPolling(id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setGeneratingId(null);
      setProgress(null);
      stopPolling();
    }
  }

  function progressText(p: GenProgress | null, mode?: SearchMode): string {
    if (!p) return "生成中…";
    if (p.phase === "fetch_urls") return "抓取参考材料链接中…";
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

  function selectEpisode(id: string) {
    setSelectedId(id);
    setLibraryOpen(false);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function backToList() {
    setSelectedId(null);
    setLibraryOpen(false);
  }

  const libraryProps = {
    episodes,
    selectedId,
    onSelect: selectEpisode,
    onEdit: (e: Episode) => {
      setEditing(e);
      setLibraryOpen(false);
    },
    onDelete: requestDelete,
  };

  return (
    <div className="col">
      <div className="layout">
        <section className="col">
          <EpisodeForm
            editing={editing}
            characters={characters}
            episodes={episodes}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </section>

        <section className="col">
          <div className="card episode-script-card" ref={detailRef}>
            {selected ? (
              <div className="episode-detail-bar">
                <h2 className="episode-detail-title">{selected.title || "（未命名节目）"}</h2>
                <button
                  type="button"
                  className="episode-detail-edit"
                  onClick={() => setEditing(selected)}
                >
                  编辑
                </button>
              </div>
            ) : (
              <h2>脚本</h2>
            )}
            {!selected && <p className="muted">从下方节目列表选择一期。</p>}
            {selected && (
              <>
                <div className="gen-row">
                  <button
                    className="primary"
                    onClick={() => handleGenerate(selected.id, false)}
                    disabled={generatingId === selected.id}
                  >
                    {generatingId === selected.id
                      ? progressText(progress, episodeSearchMode(selected))
                      : hasResumableCheckpoint(selected)
                      ? "▶ 继续生成"
                      : selected.script
                      ? "↻ 重新生成脚本"
                      : "✦ 生成脚本"}
                  </button>
                  {hasResumableCheckpoint(selected) && generatingId !== selected.id && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("将丢弃已保存的生成进度（含已写完的段落），从头重来？")) {
                          handleGenerate(selected.id, true);
                        }
                      }}
                    >
                      从头重来
                    </button>
                  )}
                  {!hasResumableCheckpoint(selected) && selected.script && generatingId !== selected.id && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("将清空当前脚本并重新生成？")) {
                          handleGenerate(selected.id, true);
                        }
                      }}
                    >
                      从头重来
                    </button>
                  )}
                  <span className="muted small">
                    {modelLabel(selected.model)}
                    {episodeSearchMode(selected) !== "off" &&
                      ` · ${searchModeLabel(episodeSearchMode(selected))}`}
                    {hasResumableCheckpoint(selected) && ` · ${checkpointHint(selected)}`}
                  </span>
                </div>
                {selected.status !== "script_ready" && selected.script?.segments?.length ? (
                  <p className="muted small">已保存部分脚本（{selected.script.segments.length} 句），可继续生成剩余段落。</p>
                ) : null}
                {error && <p className="error">⚠ {error}</p>}
                {selected.searchSources && selected.searchSources.length > 0 && (
                  <SourcesBlock sources={selected.searchSources} />
                )}
                {selected.script ? (
                  <>
                    <PodcastPlayer
                      episode={selected}
                      characters={characters}
                      onSaveSegment={(index, patch) => handleSaveSegment(selected.id, index, patch)}
                      onEject={() => setLibraryOpen(true)}
                      onPrevEpisode={() => {
                        if (prevEpisode) selectEpisode(prevEpisode.id);
                      }}
                      onNextEpisode={() => {
                        if (nextEpisode) selectEpisode(nextEpisode.id);
                      }}
                      canPrevEpisode={Boolean(prevEpisode)}
                      canNextEpisode={Boolean(nextEpisode)}
                    />
                    <button type="button" className="back-to-list below-script" onClick={backToList}>
                      ← 返回节目列表
                    </button>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {(selected.mode || "podcast") === "sitcom"
                        ? "还没有脚本。指定好旁白和至少一位主演后点「生成脚本」。"
                        : "还没有脚本。指定好主持人和至少一位嘉宾后点「生成脚本」。"}
                    </p>
                    <button type="button" className="back-to-list below-script" onClick={backToList}>
                      ← 返回节目列表
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {!selected && <EpisodeLibrary {...libraryProps} />}
        </section>
      </div>

      {libraryOpen && selected && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-dialog-title"
          onClick={() => setLibraryOpen(false)}
        >
          <div className="library-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="library-dialog-head">
              <h3 id="library-dialog-title">节目库 · 开仓换带</h3>
              <button type="button" className="library-dialog-close" onClick={() => setLibraryOpen(false)}>
                关闭
              </button>
            </div>
            <div className="library-dialog-body">
              <EpisodeLibrary {...libraryProps} />
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除节目"
          message={`确定删除节目「${pendingDelete.title}」？此操作不可撤销。`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

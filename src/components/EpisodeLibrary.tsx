import type { Episode, SearchMode } from "../types";
import { SEARCH_MODES } from "../constants";

function episodeSearchMode(e: Episode & { searchEnabled?: boolean }): SearchMode {
  if (e.searchMode) return e.searchMode;
  return e.searchEnabled ? "google" : "off";
}

function searchBadge(mode: SearchMode): string | null {
  if (mode === "off") return null;
  if (mode === "google") return "🌐 Google Search";
  if (mode === "deep_research") return "🔬 Deep Research";
  return "🔬 Deep Research Max";
}

function hasResumableCheckpoint(e: Episode | null): boolean {
  const cp = e?.genCheckpoint;
  if (!cp) return false;
  return Boolean(cp.outline || cp.searchDone || cp.urlsFetched || (cp.segments && cp.segments.length > 0));
}

function checkpointHint(e: Episode): string {
  const cp = e.genCheckpoint!;
  if (cp.outline) {
    const done = cp.nextSectionIndex || 0;
    const total = cp.sectionCount || "?";
    return `已完成 ${done}/${total} 段，可继续`;
  }
  if (cp.searchDone) return "调研已完成，可从写大纲继续";
  if (cp.urlsFetched) return "链接已抓取，可继续";
  return "有未完成进度，可继续";
}

export function EpisodeLibrary({
  episodes,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
}: {
  episodes: Episode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (e: Episode) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="ep-deck">
      <div className="ep-deck-head">
        <div className="ep-deck-title">LIBRARY</div>
        <div className="ep-deck-count">
          {episodes.length} EPISODES
        </div>
      </div>
      {episodes.length === 0 && (
        <p className="ep-deck-empty">还没有节目，先在左侧新建一期。</p>
      )}
      <div className="episode-list">
        {episodes.map((e) => {
          const isSelected = e.id === selectedId;
          const isReady = e.status === "script_ready";
          const badge = searchBadge(episodeSearchMode(e));
          const dateStr = new Date(e.createdAt || Date.now()).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
          });

          return (
            <div
              key={e.id}
              className={
                "episode-card" +
                (isSelected ? " active" : "") +
                (isReady ? " is-ready" : " is-draft")
              }
              onClick={() => onSelect(e.id)}
            >
              <div
                className={"ep-badge " + (isReady ? "ready" : "draft")}
                title={`时长 ${e.durationMinutes} 分钟（刻度满值 120 分钟）`}
              >
                <div className="ep-gauge">
                  <svg className="ep-gauge-svg" viewBox="0 0 64 64" aria-hidden="true">
                    <circle className="ep-gauge-track" cx="32" cy="32" r="26" />
                    {Array.from({ length: 12 }, (_, i) => {
                      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
                      const x1 = 32 + Math.cos(a) * 22.5;
                      const y1 = 32 + Math.sin(a) * 22.5;
                      const x2 = 32 + Math.cos(a) * 26.5;
                      const y2 = 32 + Math.sin(a) * 26.5;
                      return (
                        <line
                          key={i}
                          className="ep-gauge-tick"
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                        />
                      );
                    })}
                    <circle
                      className="ep-gauge-progress"
                      cx="32"
                      cy="32"
                      r="26"
                      pathLength={100}
                      strokeDasharray={`${Math.min(100, Math.max(0, (e.durationMinutes / 120) * 100))} 100`}
                    />
                  </svg>
                  <div className="ep-badge-well">
                    <span className="ep-badge-duration">{e.durationMinutes}</span>
                    <span className="ep-badge-unit">MIN</span>
                  </div>
                </div>
              </div>

              <div className="ep-info">
                <div className="ep-info-top">
                  <span className={"ep-card-status " + (isReady ? "ready" : "draft")}>
                    {isReady ? "READY" : "DRAFT"}
                  </span>
                  <h3 className="ep-title">{e.title || "（未命名节目）"}</h3>
                </div>
                {hasResumableCheckpoint(e) && (
                  <p className="ep-topic ep-topic-checkpoint">⏸ {checkpointHint(e)}</p>
                )}
                <div className="ep-meta">
                  <span className="ep-meta-item">
                    {e.model === "claude-opus-4-8"
                      ? "Opus"
                      : e.model?.startsWith("gemini")
                      ? "Gemini"
                      : "Sonnet"}
                  </span>
                  <span className="ep-meta-item">
                    {(e.mode || "podcast") === "sitcom" ? "情景剧" : "播客"}
                  </span>
                  <span className="ep-meta-item">
                    {(e.mode || "podcast") === "sitcom"
                      ? `主演 ${(e.leadActorIds || []).length}`
                      : `嘉宾 ${(e.guestIds || []).length}`}
                  </span>
                  {badge && <span className="ep-meta-item">{badge}</span>}
                  <span className="ep-meta-item date">{dateStr}</span>
                </div>
              </div>

              <div className="ep-actions" onClick={(ev) => ev.stopPropagation()}>
                <button
                  type="button"
                  className={"ep-key" + (isSelected ? " active" : "")}
                  onClick={() => onEdit(e)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="ep-key ep-key-danger"
                  onClick={() => onDelete(e.id)}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// re-export helpers used by EpisodesPanel
export { episodeSearchMode, hasResumableCheckpoint, checkpointHint };

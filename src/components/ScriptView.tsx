import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, Script } from "../types";

export type SegStatus = "idle" | "loading" | "ready" | "error";

const PREVIEW = 2;

export function ScriptView({
  script,
  characters,
  currentIndex = -1,
  statusByIndex,
  onSeek,
  onSaveSegment,
  onRevoice,
}: {
  script: Script;
  characters: Character[];
  currentIndex?: number;
  statusByIndex?: Record<number, SegStatus>;
  onSeek?: (index: number) => void;
  onSaveSegment?: (index: number, patch: { text: string; emotion: string }) => Promise<void>;
  onRevoice?: (index: number) => void;
}) {
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name || id;
  const wordCount = script.segments.reduce(
    (n, s) => n + s.text.replace(/\[[^\]]*\]/g, "").length,
    0
  );

  const [editing, setEditing] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftEmotion, setDraftEmotion] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const dialogListRef = useRef<HTMLOListElement | null>(null);

  function startEdit(index: number) {
    const seg = script.segments[index];
    setDraftText(seg.text);
    setDraftEmotion(seg.emotion || "");
    setEditing(index);
  }

  async function save(index: number) {
    if (!onSaveSegment) return;
    setSaving(true);
    try {
      await onSaveSegment(index, { text: draftText, emotion: draftEmotion });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  const readyCount = statusByIndex
    ? script.segments.reduce((n, _, i) => n + (statusByIndex[i] === "ready" ? 1 : 0), 0)
    : 0;

  const total = script.segments.length;
  const hasMore = total > PREVIEW;
  /** 播放中：窗口跟当前段；未播放：仍显示开头两段 */
  const previewStart = useMemo(() => {
    if (currentIndex < 0 || total === 0) return 0;
    const maxStart = Math.max(0, total - PREVIEW);
    return Math.min(Math.max(0, currentIndex), maxStart);
  }, [currentIndex, total]);
  const previewIndices = useMemo(() => {
    const end = Math.min(previewStart + PREVIEW, total);
    return Array.from({ length: end - previewStart }, (_, k) => previewStart + k);
  }, [previewStart, total]);

  useEffect(() => {
    if (!open || currentIndex < 0) return;
    const root = dialogListRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-seg-index="${currentIndex}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open, currentIndex]);

  function renderSegment(i: number, opts: { forceActions?: boolean } = {}) {
    const seg = script.segments[i];
    const st = statusByIndex?.[i] || "idle";
    const isEditing = editing === i;
    return (
      <li
        key={i}
        data-seg-index={i}
        className={"segment" + (i === currentIndex ? " current" : "") + (st === "ready" ? " cached" : "")}
      >
        <div className="seg-head">
          <span className="dot" data-status={st} title={statusLabel(st)} />
          <span className="seg-index">#{i + 1}</span>
          <span className="speaker">{nameOf(seg.speaker)}</span>
          {st === "ready" && <span className="seg-cache-badge ready">已缓存</span>}
          {st === "loading" && <span className="seg-cache-badge loading">缓存中</span>}
          {st === "error" && <span className="seg-cache-badge error">失败</span>}
          {seg.emotion && !isEditing && <span className="emotion">{seg.emotion}</span>}
          {!isEditing && (
            <span className={"seg-actions" + (opts.forceActions ? " always" : "")}>
              {onSeek && (
                <button className="mini" onClick={() => onSeek(i)} title="从这一段播放">
                  ▶
                </button>
              )}
              {onRevoice && (
                <button className="mini" onClick={() => onRevoice(i)} title="重新配音这一段（换个念法）">
                  ↻
                </button>
              )}
              {onSaveSegment && (
                <button className="mini" onClick={() => startEdit(i)} title="修改台词">
                  ✎
                </button>
              )}
            </span>
          )}
        </div>

        {isEditing ? (
          <div className="seg-edit">
            <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={4} />
            <input
              value={draftEmotion}
              onChange={(e) => setDraftEmotion(e.target.value)}
              placeholder="情绪（可选）"
            />
            <div className="actions end">
              <button disabled={saving} onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="primary" disabled={saving} onClick={() => save(i)}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        ) : (
          <p className="seg-text">{renderWithTags(seg.text)}</p>
        )}
      </li>
    );
  }

  return (
    <div className="script">
      <div className="script-meta muted small">
        {script.segments.length} 段 · 约 {wordCount} 字
        {statusByIndex && (
          <span className="script-cache-meta">
            · 已缓存 <strong>{readyCount}</strong>/{script.segments.length}
          </span>
        )}
        {currentIndex >= 0 && (
          <span className="script-now-playing">
            {" "}
            · 正在播放第 <strong>{currentIndex + 1}</strong> 段
          </span>
        )}
        {script.truncated && <span className="warn">（⚠ 可能被截断，未写完）</span>}
      </div>

      <div className={"script-preview" + (hasMore ? " has-more" : "")}>
        <ol key={previewStart} className="segments script-preview-list">
          {previewIndices.map((i) => renderSegment(i))}
        </ol>
        {hasMore && <div className="script-fade" aria-hidden="true" />}
      </div>

      {hasMore && (
        <button type="button" className="script-expand" onClick={() => setOpen(true)}>
          {currentIndex >= 0
            ? `展开全部脚本（正在第 ${currentIndex + 1}/${total} 段）`
            : `还有 ${total - PREVIEW} 段，点击展开全部脚本…`}
        </button>
      )}

      {open && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="script-dialog-title"
          onClick={() => {
            setOpen(false);
            setEditing(null);
          }}
        >
          <div className="script-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="script-dialog-head">
              <h3 id="script-dialog-title">
                全部脚本（{script.segments.length} 段 · 约 {wordCount} 字）
              </h3>
              <button
                type="button"
                className="script-dialog-close"
                onClick={() => {
                  setOpen(false);
                  setEditing(null);
                }}
              >
                关闭
              </button>
            </div>
            <ol className="segments script-dialog-list" ref={dialogListRef}>
              {script.segments.map((_, i) => renderSegment(i, { forceActions: true }))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(st: SegStatus) {
  if (st === "ready") return "已预缓存";
  if (st === "loading") return "正在生成配音";
  if (st === "error") return "配音失败";
  return "未缓存";
}

function renderWithTags(text: string) {
  const parts = text.split(/(\[[^\]]*\])/g);
  return parts.map((p, i) =>
    /^\[[^\]]*\]$/.test(p) ? (
      <span key={i} className="tag-inline">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

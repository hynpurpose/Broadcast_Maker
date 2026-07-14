import { useState } from "react";
import type { Character, Script } from "../types";

export type SegStatus = "idle" | "loading" | "ready" | "error";

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

  return (
    <div className="script">
      <div className="script-meta muted small">
        {script.segments.length} 段 · 约 {wordCount} 字
        {script.truncated && <span className="warn">（⚠ 可能被截断，未写完）</span>}
      </div>
      <ol className="segments">
        {script.segments.map((seg, i) => {
          const st = statusByIndex?.[i];
          const isEditing = editing === i;
          return (
            <li
              key={i}
              className={"segment" + (i === currentIndex ? " current" : "")}
            >
              <div className="seg-head">
                <span className="dot" data-status={st || "idle"} />
                <span className="speaker">{nameOf(seg.speaker)}</span>
                {seg.emotion && !isEditing && <span className="emotion">{seg.emotion}</span>}
                {!isEditing && (
                  <span className="seg-actions">
                    {onSeek && (
                      <button className="mini" onClick={() => onSeek(i)} title="从这一段播放">▶</button>
                    )}
                    {onRevoice && (
                      <button className="mini" onClick={() => onRevoice(i)} title="重新配音这一段（换个念法）">
                        ↻
                      </button>
                    )}
                    {onSaveSegment && (
                      <button className="mini" onClick={() => startEdit(i)} title="修改台词">✎</button>
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
                  <div className="actions">
                    <button className="primary" disabled={saving} onClick={() => save(i)}>
                      {saving ? "保存中…" : "保存"}
                    </button>
                    <button disabled={saving} onClick={() => setEditing(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <p className="seg-text">{renderWithTags(seg.text)}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Highlight [markup] tags so they're visually distinct from spoken words.
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

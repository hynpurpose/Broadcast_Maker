import { useState } from "react";
import type { SearchSource } from "../types";

const PREVIEW = 5;

export function SourcesBlock({ sources }: { sources: SearchSource[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  const preview = sources.slice(0, PREVIEW);
  const rest = sources.length - preview.length;

  return (
    <>
      <div className="sources">
        <div className="sources-head">
          <span className="muted small">参考来源（Gemini 联网）· 共 {sources.length} 条</span>
        </div>
        <ul>
          {preview.map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
        {rest > 0 && (
          <button type="button" className="sources-expand" onClick={() => setOpen(true)}>
            还有 {rest} 条，点击展开…
          </button>
        )}
      </div>

      {open && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sources-dialog-title"
          onClick={() => setOpen(false)}
        >
          <div className="sources-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sources-dialog-head">
              <h3 id="sources-dialog-title">全部参考来源（{sources.length}）</h3>
              <button type="button" className="sources-dialog-close" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <ol className="sources-dialog-list">
              {sources.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <span className="sources-dialog-url">{s.url}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </>
  );
}

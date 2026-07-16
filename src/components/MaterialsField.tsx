import { useEffect, useRef, useState, type ReactNode } from "react";

function inlineFormat(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|https?:\/\/[^\s<>"')\]]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <a key={key++} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlocks(raw: string): ReactNode[] {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list || !list.items.length) {
      list = null;
      return;
    }
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={key++} className="materials-list">
        {list.items.map((item, i) => (
          <li key={i}>{inlineFormat(item)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 3);
      out.push(
        <div
          key={key++}
          className={"materials-heading materials-h" + level}
          role="heading"
          aria-level={level + 2}
        >
          {inlineFormat(heading[2])}
        </div>
      );
      continue;
    }

    // Plain section titles written as 【标题】
    const bracketTitle = trimmed.match(/^【([^】]+)】$/);
    if (bracketTitle) {
      flushList();
      out.push(
        <h3 key={key++} className="materials-heading">
          {bracketTitle[1]}
        </h3>
      );
      continue;
    }

    const ul = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ul) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }

    const ol = trimmed.match(/^\d+[.)、]\s+(.+)$/);
    if (ol) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      out.push(<hr key={key++} className="materials-hr" />);
      continue;
    }

    flushList();
    out.push(
      <p key={key++} className="materials-p">
        {inlineFormat(trimmed)}
      </p>
    );
  }
  flushList();
  return out;
}

export function MaterialsField({
  label = "参考材料（文字要点、数据、观点等）",
  value,
  onChange,
  rows = 6,
  placeholder,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const hasContent = Boolean(value.trim());
  const [editing, setEditing] = useState(!hasContent);
  const prevLenRef = useRef(value.trim().length);

  useEffect(() => {
    const len = value.trim().length;
    // Research / paste filled a lot of text → show readable preview.
    if (prevLenRef.current < 40 && len > 80) setEditing(false);
    prevLenRef.current = len;
  }, [value]);

  return (
    <div className="materials-field">
      <div className="field-head">
        <span>{label}</span>
        {hasContent && (
          <button
            type="button"
            className="mini"
            onClick={() => setEditing((v) => !v)}
            title={editing ? "按常规格式预览" : "编辑原文"}
          >
            {editing ? "预览" : "编辑"}
          </button>
        )}
      </div>
      {editing || !hasContent ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
        />
      ) : (
        <div className="materials-preview" tabIndex={0}>
          {renderBlocks(value)}
        </div>
      )}
    </div>
  );
}

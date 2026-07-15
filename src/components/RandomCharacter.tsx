import { useRef, useState } from "react";
import type { CharacterDraft } from "../types";
import { api } from "../api";

const EDUCATION_OPTIONS = [
  { value: "low", label: "低" },
  { value: "mid", label: "中" },
  { value: "high", label: "高" },
  { value: "elite", label: "极高" },
  { value: "expert", label: "专家" },
] as const;

const PERSONALITY_OPTIONS = [
  { value: "gentle", label: "温柔" },
  { value: "soft", label: "偏温柔" },
  { value: "balanced", label: "中性" },
  { value: "spicy", label: "偏泼辣" },
  { value: "fierce", label: "泼辣" },
] as const;

const OPENNESS_OPTIONS = [
  { value: "conservative", label: "保守" },
  { value: "cautious", label: "偏保守" },
  { value: "neutral", label: "中性" },
  { value: "open", label: "偏开放" },
  { value: "radical", label: "开放" },
] as const;

function SegmentAxis<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [dragPct, setDragPct] = useState<number | null>(null);

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const last = Math.max(1, options.length - 1);

  function pctFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return (index / last) * 100;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return (index / last) * 100;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, ratio)) * 100;
  }

  function indexFromPct(pct: number) {
    return Math.max(0, Math.min(last, Math.round((pct / 100) * last)));
  }

  const previewIndex = dragPct === null ? index : indexFromPct(dragPct);
  const current = options[previewIndex] || options[0];
  const thumbPct = dragPct === null ? (index / last) * 100 : dragPct;

  function commitIndex(i: number) {
    const next = options[i];
    if (next) onChange(next.value);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pct = pctFromClientX(e.clientX);
    setDragPct(pct);
    commitIndex(indexFromPct(pct));
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const pct = pctFromClientX(e.clientX);
    setDragPct(pct);
    commitIndex(indexFromPct(pct));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const i = indexFromPct(pctFromClientX(e.clientX));
    commitIndex(i);
    setDragPct(null);
  }

  return (
    <div className="axis-field">
      <div className="axis-title">
        <span>{title}</span>
        <span className="axis-current">{current.label}</span>
      </div>

      <div
        ref={trackRef}
        className={"axis-track" + (dragPct !== null ? " dragging" : "")}
        role="slider"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={previewIndex}
        aria-valuetext={current.label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            commitIndex(Math.max(0, index - 1));
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            commitIndex(Math.min(last, index + 1));
          } else if (e.key === "Home") {
            e.preventDefault();
            commitIndex(0);
          } else if (e.key === "End") {
            e.preventDefault();
            commitIndex(last);
          }
        }}
      >
        <div className="axis-rail" />
        {options.map((opt, i) => (
          <span
            key={opt.value}
            className={"axis-stop" + (i === previewIndex ? " active" : "")}
            style={{ left: `${(i / last) * 100}%` }}
          />
        ))}
        <span className="axis-thumb" style={{ left: `${thumbPct}%` }} />
      </div>
    </div>
  );
}

export function RandomCharacter({
  onGenerated,
}: {
  onGenerated: (draft: CharacterDraft) => void;
}) {
  const [education, setEducation] = useState<(typeof EDUCATION_OPTIONS)[number]["value"]>("mid");
  const [expertField, setExpertField] = useState("");
  const [personality, setPersonality] =
    useState<(typeof PERSONALITY_OPTIONS)[number]["value"]>("balanced");
  const [openness, setOpenness] = useState<(typeof OPENNESS_OPTIONS)[number]["value"]>("neutral");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    if (education === "expert" && !expertField.trim()) {
      setError("请填写专家的具体领域");
      return;
    }
    setLoading(true);
    try {
      const result = await api.generateRandomCharacter({
        education,
        personality,
        openness,
        expertField: education === "expert" ? expertField.trim() : undefined,
      });
      onGenerated({
        name: result.name,
        persona: result.persona,
        languageStyle: result.languageStyle,
        faction: result.faction,
        backstory: result.backstory,
        defaultEmotion: result.defaultEmotion,
        speed: result.speed,
        voiceId: "",
        avatar: "",
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card form">
      <h2>随机生成角色</h2>

      <label>
        受教育程度
        <div className="chip-row">
          {EDUCATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={"chip" + (education === opt.value ? " active" : "")}
              onClick={() => setEducation(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </label>

      {education === "expert" && (
        <label>
          专家领域
          <input
            value={expertField}
            onChange={(e) => setExpertField(e.target.value)}
            placeholder="例如：量子计算、劳动法、古建筑修复……"
          />
        </label>
      )}

      <SegmentAxis
        title="性格光轴"
        options={PERSONALITY_OPTIONS}
        value={personality}
        onChange={setPersonality}
      />

      <SegmentAxis
        title="阵营光轴"
        options={OPENNESS_OPTIONS}
        value={openness}
        onChange={setOpenness}
      />

      <div className="actions end">
        <button
          type="button"
          className="primary"
          onClick={generate}
          disabled={loading || (education === "expert" && !expertField.trim())}
        >
          {loading ? "生成中…" : "🎲 随机生成"}
        </button>
      </div>

      {error && <p className="error">⚠ {error}</p>}
    </div>
  );
}

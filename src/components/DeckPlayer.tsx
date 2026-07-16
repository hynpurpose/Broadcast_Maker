import { useEffect, useRef, useState, type MouseEvent } from "react";
import iconCache from "../assets/icon-cache.png";
import iconExport from "../assets/icon-export.png";

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function formatHms(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function formatClock(d = new Date()) {
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** 复古机头 LCD：超长曲名左右循环滚动 */
function MarqueeTitle({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [duration, setDuration] = useState(10);

  useEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;

    const check = () => {
      const need = measure.scrollWidth > wrap.clientWidth + 1;
      setOverflow(need);
      if (need) {
        // ~28px/s，越长越久，像老卡带机跑马灯
        setDuration(Math.max(8, measure.scrollWidth / 28));
      }
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div ref={wrapRef} className={"deck-title" + (overflow ? " is-marquee" : "")}>
      <span ref={measureRef} className="deck-title-measure">
        {text}
      </span>
      {overflow ? (
        <div className="deck-title-track" style={{ animationDuration: `${duration}s` }}>
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </div>
      ) : (
        <span className="deck-title-text">{text}</span>
      )}
    </div>
  );
}

/** One MediaElementSource per <audio> — cannot recreate after first bind. */
const audioGraphs = new WeakMap<
  HTMLAudioElement,
  { ctx: AudioContext; analyser: AnalyserNode }
>();

function ensureAnalyser(audio: HTMLAudioElement): AnalyserNode | null {
  const existing = audioGraphs.get(audio);
  if (existing) return existing.analyser;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioGraphs.set(audio, { ctx, analyser });
    return analyser;
  } catch {
    return null;
  }
}

export function DeckPlayer({
  title,
  speaker,
  playing,
  currentIndex,
  total,
  currentTime,
  segmentDuration,
  readyCount,
  onPlayPause,
  onStop,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onPrevEpisode,
  onNextEpisode,
  canPrevEpisode = false,
  canNextEpisode = false,
  onPrewarm,
  onExport,
  prewarming = false,
  exporting = false,
  progressDone = 0,
  progressFailed = 0,
  audioEl = null,
  onEject,
  notice = null,
  onScrubBy,
  canScrub = false,
}: {
  title: string;
  speaker: string;
  playing: boolean;
  currentIndex: number;
  total: number;
  currentTime: number;
  segmentDuration: number;
  readyCount: number;
  onPlayPause: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onPrevEpisode?: () => void;
  onNextEpisode?: () => void;
  canPrevEpisode?: boolean;
  canNextEpisode?: boolean;
  onPrewarm: () => void;
  onExport: () => void;
  prewarming?: boolean;
  exporting?: boolean;
  progressDone?: number;
  progressFailed?: number;
  audioEl?: HTMLAudioElement | null;
  onEject?: () => void;
  notice?: string | null;
  /** 侧面滚轮：+1 下一段 / -1 上一段 */
  onScrubBy?: (delta: number) => void;
  canScrub?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const playingRef = useRef(playing);
  const timeRef = useRef(currentTime);
  const durRef = useRef(segmentDuration);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timeDataRef = useRef<Uint8Array | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const wheelAccRef = useRef(0);
  const sliderRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);
  useEffect(() => {
    durRef.current = segmentDuration;
  }, [segmentDuration]);

  useEffect(() => {
    if (!scrubbing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setScrubbing(false);
    };
    const onPointer = (e: PointerEvent) => {
      const el = sliderRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setScrubbing(false);
    };
    const onWheel = (e: globalThis.WheelEvent) => {
      if (!onScrubBy) return;
      e.preventDefault();
      wheelAccRef.current += e.deltaY;
      if (Math.abs(wheelAccRef.current) < 28) return;
      const dir = wheelAccRef.current > 0 ? 1 : -1;
      wheelAccRef.current = 0;
      onScrubBy(dir);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("wheel", onWheel);
    };
  }, [scrubbing, onScrubBy]);

  useEffect(() => {
    if (!scrubbing) wheelAccRef.current = 0;
  }, [scrubbing]);

  function toggleScrub(e: MouseEvent) {
    e.stopPropagation();
    if (!canScrub || !onScrubBy) return;
    setScrubbing((v) => !v);
  }

  useEffect(() => {
    if (!audioEl) return;
    const analyser = ensureAnalyser(audioEl);
    analyserRef.current = analyser;
    if (analyser) {
      timeDataRef.current = new Uint8Array(analyser.fftSize);
    }
  }, [audioEl]);

  useEffect(() => {
    if (!playing || !audioEl) return;
    const graph = audioGraphs.get(audioEl);
    if (graph?.ctx.state === "suspended") {
      graph.ctx.resume().catch(() => {});
    }
  }, [playing, audioEl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // fine CRT scanlines
      g.fillStyle = "rgba(255,255,255,0.025)";
      for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1);

      const dur = durRef.current;
      const cur = timeRef.current;
      const progress = dur > 0 ? Math.min(1, cur / dur) : 0;
      const playX = progress * w;
      const mid = h / 2;
      const live = playingRef.current;

      // Thin vertical strokes — denser, ~1.5px
      const step = 3;
      const lineW = 1.25;
      const analyser = analyserRef.current;
      const data = timeDataRef.current;

      if (live && analyser && data) {
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
      }

      for (let x = 0; x < playX; x += step) {
        let amp: number;
        if (live && data && data.length) {
          const idx = Math.floor((x / Math.max(playX, 1)) * (data.length - 1));
          const v = (data[idx] - 128) / 128;
          amp = Math.min(1, Math.abs(v) * 1.8);
        } else {
          // idle silhouette: soft seeded noise
          const n = Math.sin(x * 0.21) * Math.cos(x * 0.07 + 1.7);
          amp = 0.08 + 0.12 * Math.abs(n);
        }
        const bh = Math.max(1.5, amp * (h * 0.38));
        g.fillStyle = "#f4f4f4";
        g.fillRect(x, mid - bh, lineW, bh * 2);
      }

      // Future path: sparse dashed ticks
      g.fillStyle = "rgba(255,255,255,0.28)";
      for (let x = playX + 4; x < w; x += 5) {
        g.fillRect(x, mid - 0.75, 2.5, 1.5);
      }

      // Red playhead
      g.strokeStyle = "#e11d2e";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(playX, 6);
      g.lineTo(playX, h - 6);
      g.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const segLabel = currentIndex < 0 ? "READY" : `SEG ${currentIndex + 1}/${total}`;
  const cacheLabel =
    readyCount >= total && total > 0 ? "已缓存" : `已缓存 ${readyCount}/${total}`;
  const busy = prewarming || exporting;
  const progressPct = total > 0 ? Math.round((progressDone / total) * 100) : 0;
  const cachePct = total > 0 ? Math.round((readyCount / total) * 100) : 0;
  const prewarmLabel = prewarming
    ? `停止 ${progressDone}/${total}`
    : readyCount >= total && total > 0
      ? "已全部缓存"
      : `预缓存 · ${readyCount}/${total}`;
  const exportLabel = exporting ? `停止 ${progressDone}/${total}` : "导出 MP3";

  return (
    <div className="deck">
      <div className="deck-bezel">
        <div className="deck-screen">
          <div className="deck-status">
            <span className="deck-clock">{formatClock()}</span>
            <span className="deck-status-mid">
              <span className={"deck-rec-dot" + (playing || scrubbing ? " live" : "")} />
              {scrubbing
                ? "SCRUB MODE"
                : playing
                  ? "NOW PLAYING"
                  : busy
                    ? exporting
                      ? "EXPORTING"
                      : "CACHING"
                    : "STAND BY"}
            </span>
            <span className="deck-status-right">
              <span className="deck-seg-tag">{segLabel}</span>
            </span>
          </div>

          <div className="deck-wave-wrap">
            <canvas ref={canvasRef} className="deck-wave" />
            {notice && (
              <div className="deck-wave-notice" role="status" aria-live="polite">
                {notice}
              </div>
            )}
          </div>

          <div className="deck-meta-row">
            <div className="deck-timer">{formatHms(currentTime)}</div>
            <div className="deck-track-info">
              <MarqueeTitle text={title || "Untitled Episode"} />
              <div className="deck-speaker">{speaker || "—"}</div>
            </div>
            <div className="deck-timer deck-timer-end">{formatHms(segmentDuration)}</div>
          </div>

          {busy && (
            <div className="deck-screen-progress" role="progressbar" aria-valuenow={progressDone} aria-valuemin={0} aria-valuemax={total}>
              <div className="deck-screen-progress-bar" style={{ width: `${progressPct}%` }} />
              <span className="deck-screen-progress-label">
                {exporting ? "EXPORT" : "CACHE"} {progressDone}/{total} · {progressPct}%
                {!exporting && progressFailed > 0 ? ` · FAIL ${progressFailed}` : ""}
              </span>
            </div>
          )}
        </div>

        <div className="deck-grille">
          <div className="deck-battery" title={`已缓存 ${readyCount}/${total}`}>
            <span className="deck-battery-icon" aria-hidden="true" />
            <span>{cachePct}%</span>
          </div>
          <div className="deck-grille-mesh" aria-hidden="true" />
          {onEject && (
            <button
              type="button"
              className="deck-eject"
              onClick={onEject}
              title="开仓 · 切换节目"
              aria-label="开仓切换节目"
            >
              <span className="deck-eject-glyph" aria-hidden="true">
                <span className="deck-eject-tri" />
                <span className="deck-eject-bar" />
              </span>
              <span className="deck-eject-label">EJECT</span>
            </button>
          )}
        </div>

        <div className="deck-controls">
          <button
            type="button"
            className={"deck-key deck-key-well deck-key-play" + (playing ? " active" : "")}
            onClick={onPlayPause}
            aria-label={playing ? "暂停" : "播放"}
            title={playing ? "暂停" : "播放"}
          >
            <span className="deck-well">
              {playing ? <span className="deck-icon-pause" /> : <span className="deck-icon-rec" />}
            </span>
          </button>

          <button
            type="button"
            className="deck-key deck-key-well deck-key-stop"
            onClick={onStop}
            aria-label="停止"
            title="停止"
          >
            <span className="deck-well">
              <span className="deck-icon-stop" />
            </span>
          </button>

          <div className="deck-key-stack">
            <button
              type="button"
              className="deck-key deck-key-flat"
              onClick={onPrev}
              disabled={!canPrev}
              aria-label="上一段"
              title="上一段脚本"
            >
              <span className="deck-icon-prev" />
            </button>
            <button
              type="button"
              className="deck-key deck-key-flat"
              onClick={onNext}
              disabled={!canNext}
              aria-label="下一段"
              title="下一段脚本"
            >
              <span className="deck-icon-next" />
            </button>
          </div>

          {(onPrevEpisode || onNextEpisode) && (
            <div className="deck-key-stack">
              <button
                type="button"
                className="deck-key deck-key-flat"
                onClick={onPrevEpisode}
                disabled={!canPrevEpisode}
                aria-label="上一期节目"
                title="上一期节目"
              >
                <span className="deck-icon-ep-prev" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="deck-key deck-key-flat"
                onClick={onNextEpisode}
                disabled={!canNextEpisode}
                aria-label="下一期节目"
                title="下一期节目"
              >
                <span className="deck-icon-ep-next" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="deck-actions">
          <button
            type="button"
            className={"deck-key deck-key-action" + (prewarming ? " busy" : "")}
            onClick={onPrewarm}
            disabled={exporting}
            title={
              prewarming
                ? "点击停止预缓存"
                : `提前生成全部段落配音（${cacheLabel}）`
            }
          >
            <span className="deck-action-icon" aria-hidden="true">
              <img src={iconCache} alt="" className="deck-action-img" />
            </span>
            <span className="deck-action-label">{prewarmLabel}</span>
          </button>
          <button
            type="button"
            className={"deck-key deck-key-action" + (exporting ? " busy" : "")}
            onClick={onExport}
            disabled={prewarming}
            title={
              exporting
                ? "点击停止导出"
                : "用已缓存配音在本地拼成 mp3；缺段会自动补生成"
            }
          >
            <span className="deck-action-icon" aria-hidden="true">
              <img src={iconExport} alt="" className="deck-action-img" />
            </span>
            <span className="deck-action-label">{exportLabel}</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        ref={sliderRef}
        className={
          "deck-side-slider" +
          (scrubbing ? " is-scrubbing" : "") +
          (!canScrub ? " is-disabled" : "")
        }
        onClick={toggleScrub}
        disabled={!canScrub}
        aria-pressed={scrubbing}
        aria-label={scrubbing ? "退出快速拉进度" : "进入快速拉进度"}
        title={
          scrubbing
            ? "滚轮切换句子 · 再点退出（Esc）"
            : "点击进入快速拉进度，滚轮切换当前句子"
        }
      />
    </div>
  );
}

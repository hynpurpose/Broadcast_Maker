import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, Episode } from "../types";
import { api } from "../api";
import { ScriptView, type SegStatus } from "./ScriptView";

const PREFETCH_AHEAD = 2; // 提前预取后面几段
/** Fish Audio 当前档位并发上限；预缓存 / 导出按此并行拉 TTS */
const TTS_CONCURRENCY = 5;

/** 有限并发跑完 list，结果按原下标排列；每完成一项回调 onDone。 */
async function mapPool<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
  onDone?: (done: number) => void
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  let done = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= count) return;
      results[i] = await worker(i);
      done += 1;
      onDone?.(done);
    }
  }
  const n = Math.min(Math.max(1, concurrency), count);
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

export function PodcastPlayer({
  episode,
  characters,
  onSaveSegment,
}: {
  episode: Episode;
  characters: Character[];
  onSaveSegment: (index: number, patch: { text: string; emotion: string }) => Promise<void>;
}) {
  const segments = episode.script?.segments ?? [];
  const n = segments.length;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cached by content key (voice|speed|text) so editing one segment only
  // invalidates that segment; unchanged segments keep their audio.
  const urlsRef = useRef<Record<string, string | undefined>>({});
  const promisesRef = useRef<Record<string, Promise<string> | undefined>>({});
  const currentRef = useRef<number>(-1);

  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<Record<number, SegStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [prewarming, setPrewarming] = useState(false);
  const [prewarmDone, setPrewarmDone] = useState(0);
  const [prewarmFailed, setPrewarmFailed] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(0);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const resolve = useCallback(
    (index: number) => {
      const seg = segments[index];
      const c = characters.find((ch) => ch.id === seg.speaker);
      return { text: seg.text, voiceId: c?.voiceId || undefined, speed: c?.speed };
    },
    [segments, characters]
  );

  const keyOf = useCallback(
    (index: number) => {
      const { text, voiceId, speed } = resolve(index);
      return `${voiceId || ""}|${speed || 1}|${text}`;
    },
    [resolve]
  );

  // 确保某段音频已生成，返回其 blob url。bust=true 时强制重生成（重配）。
  const ensureAudio = useCallback(
    (index: number, bust = false): Promise<string> => {
      const key = keyOf(index);
      if (!bust) {
        const cached = urlsRef.current[key];
        if (cached) {
          setStatus((s) => (s[index] === "ready" ? s : { ...s, [index]: "ready" }));
          return Promise.resolve(cached);
        }
        const inflight = promisesRef.current[key];
        if (inflight) {
          // 同内容其它段在飞：本段也标 loading，完成后标 ready
          setStatus((s) => ({ ...s, [index]: "loading" }));
          return inflight.then((url) => {
            setStatus((s) => ({ ...s, [index]: "ready" }));
            return url;
          });
        }
      } else {
        const old = urlsRef.current[key];
        if (old) URL.revokeObjectURL(old);
        delete urlsRef.current[key];
        delete promisesRef.current[key];
      }
      const { text, voiceId, speed } = resolve(index);
      setStatus((s) => ({ ...s, [index]: "loading" }));
      const p = api
        .tts(text, { voiceId, speed, nocache: bust })
        .then((url) => {
          urlsRef.current[key] = url;
          setStatus((s) => ({ ...s, [index]: "ready" }));
          return url;
        })
        .catch((e) => {
          setStatus((s) => ({ ...s, [index]: "error" }));
          delete promisesRef.current[key];
          throw e;
        });
      promisesRef.current[key] = p;
      return p;
    },
    [keyOf, resolve]
  );

  const playIndex = useCallback(
    async (index: number) => {
      if (index < 0 || index >= n) return;
      setError(null);
      setCurrent(index);
      for (let k = 1; k <= PREFETCH_AHEAD; k++) {
        if (index + k < n) ensureAudio(index + k).catch(() => {});
      }
      try {
        const url = await ensureAudio(index);
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = url;
        await audio.play();
        setPlaying(true);
      } catch (e) {
        setPlaying(false);
        setError(`第 ${index + 1} 段配音失败：${e instanceof Error ? e.message : e}`);
      }
    },
    [ensureAudio, n]
  );

  const onEnded = useCallback(() => {
    const next = currentRef.current + 1;
    if (next < n) playIndex(next);
    else setPlaying(false);
  }, [n, playIndex]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else if (current < 0) {
      playIndex(0);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }

  async function revoice(index: number) {
    setError(null);
    try {
      const url = await ensureAudio(index, true);
      if (index === currentRef.current && audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
        setPlaying(true);
      }
    } catch (e) {
      setError(`第 ${index + 1} 段重配失败：${e instanceof Error ? e.message : e}`);
    }
  }

  async function handleSaveSegment(index: number, patch: { text: string; emotion: string }) {
    await onSaveSegment(index, patch);
    // 文本变了：旧 key 的缓存自然失效，把该段状态点复位
    setStatus((s) => ({ ...s, [index]: "idle" }));
  }

  async function prewarmAll() {
    setPrewarming(true);
    setPrewarmDone(0);
    setPrewarmFailed(0);
    let failed = 0;
    try {
      await mapPool(
        n,
        TTS_CONCURRENCY,
        async (i) => {
          try {
            await ensureAudio(i);
          } catch {
            failed += 1;
            setPrewarmFailed(failed);
          }
        },
        (done) => setPrewarmDone(done)
      );
      if (failed > 0) {
        setError(`预缓存完成，但有 ${failed} 段失败（红点）。导出前请重试失败段或点「预缓存全部」。`);
      }
    } finally {
      setPrewarming(false);
    }
  }

  /** 优先用播放器内存里已缓存的段落拼接；缺的再走 /api/tts（磁盘缓存或 Fish）。 */
  async function exportMp3() {
    setError(null);
    setExporting(true);
    setExportDone(0);
    try {
      const parts = await mapPool(
        n,
        TTS_CONCURRENCY,
        async (i) => {
          try {
            const url = await ensureAudio(i);
            const buf = await fetch(url).then((r) => {
              if (!r.ok) throw new Error(`读取第 ${i + 1} 段音频失败`);
              return r.arrayBuffer();
            });
            return buf;
          } catch (e) {
            throw new Error(
              `第 ${i + 1} 段无法导出：${e instanceof Error ? e.message : e}`
            );
          }
        },
        (done) => setExportDone(done)
      );
      const blob = new Blob(parts, { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${episode.title || "podcast"}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(`导出失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
    }
  }

  // 切换到其它节目时重置播放状态、回收 blob（仅在 id 变化时，编辑单段不触发）
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    urlsRef.current = {};
    promisesRef.current = {};
    setCurrent(-1);
    setPlaying(false);
    setStatus({});
    setError(null);
    setPrewarming(false);
    setPrewarmDone(0);
    setPrewarmFailed(0);
    setExporting(false);
    setExportDone(0);
  }, [episode.id]);

  // 卸载时回收
  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, []);

  if (!episode.script || n === 0) return null;

  const progressDone = exporting ? exportDone : prewarmDone;
  const progressActive = prewarming || exporting;
  const progressPct = n > 0 ? Math.round((progressDone / n) * 100) : 0;

  return (
    <div className="player-panel">
      <div className="player-bar">
        <button onClick={() => playIndex(current <= 0 ? 0 : current - 1)}
          disabled={current <= 0} title="上一段">⏮</button>
        <button className="primary" onClick={togglePlay}>
          {playing ? "⏸ 暂停" : current < 0 ? "▶ 从头播放" : "▶ 继续"}
        </button>
        <button onClick={() => playIndex(current + 1)} disabled={current >= n - 1} title="下一段">⏭</button>

        <span className="counter muted small">{current < 0 ? "—" : current + 1} / {n}</span>

        <button className="ghost" onClick={prewarmAll} disabled={prewarming || exporting} title="提前生成全部段落配音">
          {prewarming ? `预缓存中… ${prewarmDone}/${n}` : "⚡ 预缓存全部"}
        </button>
        <button onClick={exportMp3} disabled={exporting || prewarming} title="用已缓存配音在本地拼成 mp3；缺段会自动补生成">
          {exporting ? `导出中… ${exportDone}/${n}` : "⬇ 导出 mp3"}
        </button>
      </div>

      {progressActive && (
        <div className="prewarm-progress" role="progressbar" aria-valuenow={progressDone} aria-valuemin={0} aria-valuemax={n}>
          <div className="prewarm-progress-bar" style={{ width: `${progressPct}%` }} />
          <span className="prewarm-progress-label muted small">
            {exporting ? "导出拼接" : "配音预缓存"} {progressDone}/{n}（{progressPct}%）
            {!exporting && prewarmFailed > 0 ? ` · 失败 ${prewarmFailed}` : ""}
          </span>
        </div>
      )}

      {error && <p className="error">⚠ {error}</p>}

      <audio ref={audioRef} controls onEnded={onEnded} onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)} className="player" />

      <ScriptView
        script={episode.script}
        characters={characters}
        currentIndex={current}
        statusByIndex={status}
        onSeek={playIndex}
        onSaveSegment={handleSaveSegment}
        onRevoice={revoice}
      />
    </div>
  );
}

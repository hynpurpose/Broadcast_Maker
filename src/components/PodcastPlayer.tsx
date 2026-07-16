import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character, Episode } from "../types";
import { api } from "../api";
import { ScriptView, type SegStatus } from "./ScriptView";
import { DeckPlayer } from "./DeckPlayer";

const PREFETCH_AHEAD = 2; // 提前预取后面几段
/** Fish Audio 当前档位并发上限；预缓存 / 导出按此并行拉 TTS */
const TTS_CONCURRENCY = 5;

function isAbortError(e: unknown) {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/** 有限并发跑完 list，结果按原下标排列；每完成一项回调 onDone。可中途 abort。 */
async function mapPool<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
  onDone?: (done: number) => void,
  signal?: AbortSignal
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  let done = 0;
  async function run() {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const i = next++;
      if (i >= count) return;
      results[i] = await worker(i);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
  onEject,
  onPrevEpisode,
  onNextEpisode,
  canPrevEpisode = false,
  canNextEpisode = false,
}: {
  episode: Episode;
  characters: Character[];
  onSaveSegment: (index: number, patch: { text: string; emotion: string }) => Promise<void>;
  onEject?: () => void;
  onPrevEpisode?: () => void;
  onNextEpisode?: () => void;
  canPrevEpisode?: boolean;
  canNextEpisode?: boolean;
}) {
  const segments = episode.script?.segments ?? [];
  const n = segments.length;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cached by content key (voice|speed|text) so editing one segment only
  // invalidates that segment; unchanged segments keep their audio.
  const urlsRef = useRef<Record<string, string | undefined>>({});
  const promisesRef = useRef<Record<string, Promise<string> | undefined>>({});
  const currentRef = useRef<number>(-1);
  const scrubGenRef = useRef(0);

  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<Record<number, SegStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prewarming, setPrewarming] = useState(false);
  const [prewarmDone, setPrewarmDone] = useState(0);
  const [prewarmFailed, setPrewarmFailed] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [segmentDuration, setSegmentDuration] = useState(0);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const jobAbortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  function abortJob() {
    jobAbortRef.current?.abort();
    jobAbortRef.current = null;
  }

  function clearNoticeTimer() {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }

  /** 短暂提示（如已停止），约 2 秒后自动消失；显示在波形区 */
  function flashNotice(message: string, ms = 2000) {
    clearNoticeTimer();
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => {
      setNotice((prev) => (prev === message ? null : prev));
      noticeTimerRef.current = null;
    }, ms);
  }

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

  const readyCount = useMemo(() => {
    let c = 0;
    for (let i = 0; i < n; i++) if (status[i] === "ready") c += 1;
    return c;
  }, [status, n]);

  const markStatus = useCallback((index: number, st: SegStatus) => {
    setStatus((prev) => (prev[index] === st ? prev : { ...prev, [index]: st }));
  }, []);

  // 确保某段音频已生成，返回其 blob url。bust=true 时强制重生成（重配）。
  const ensureAudio = useCallback(
    (index: number, bust = false, signal?: AbortSignal): Promise<string> => {
      if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      const key = keyOf(index);
      if (!bust) {
        const cached = urlsRef.current[key];
        if (cached) {
          markStatus(index, "ready");
          return Promise.resolve(cached);
        }
        const inflight = promisesRef.current[key];
        if (inflight) {
          markStatus(index, "loading");
          if (!signal) {
            return inflight.then((url) => {
              markStatus(index, "ready");
              return url;
            });
          }
          // 可取消：等已有请求，但 abort 时立刻结束（不打断共享中的请求）
          return new Promise<string>((resolve, reject) => {
            const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
            signal.addEventListener("abort", onAbort, { once: true });
            inflight
              .then((url) => {
                signal.removeEventListener("abort", onAbort);
                if (signal.aborted) {
                  reject(new DOMException("Aborted", "AbortError"));
                  return;
                }
                markStatus(index, "ready");
                resolve(url);
              })
              .catch((e) => {
                signal.removeEventListener("abort", onAbort);
                reject(e);
              });
          });
        }
      } else {
        const old = urlsRef.current[key];
        if (old) URL.revokeObjectURL(old);
        delete urlsRef.current[key];
        delete promisesRef.current[key];
      }
      const { text, voiceId, speed } = resolve(index);
      markStatus(index, "loading");
      const p = api
        .tts(text, { voiceId, speed, nocache: bust, signal })
        .then((url) => {
          urlsRef.current[key] = url;
          delete promisesRef.current[key];
          markStatus(index, "ready");
          return url;
        })
        .catch((e) => {
          delete promisesRef.current[key];
          if (isAbortError(e)) {
            markStatus(index, urlsRef.current[key] ? "ready" : "idle");
          } else {
            markStatus(index, "error");
          }
          throw e;
        });
      promisesRef.current[key] = p;
      return p;
    },
    [keyOf, resolve, markStatus]
  );

  const playIndex = useCallback(
    async (index: number) => {
      if (index < 0 || index >= n) return;
      const gen = ++scrubGenRef.current;
      setError(null);
      setCurrent(index);
      for (let k = 1; k <= PREFETCH_AHEAD; k++) {
        if (index + k < n) ensureAudio(index + k).catch(() => {});
      }
      try {
        const url = await ensureAudio(index);
        if (gen !== scrubGenRef.current) return;
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = url;
        await audio.play();
        if (gen !== scrubGenRef.current) return;
        setPlaying(true);
      } catch (e) {
        if (gen !== scrubGenRef.current) return;
        setPlaying(false);
        setError(`第 ${index + 1} 段配音失败：${e instanceof Error ? e.message : e}`);
      }
    },
    [ensureAudio, n]
  );

  const scrubBy = useCallback(
    (delta: number) => {
      if (n <= 0) return;
      const base = currentRef.current < 0 ? 0 : currentRef.current;
      const next = Math.max(0, Math.min(n - 1, base + delta));
      if (next === currentRef.current && currentRef.current >= 0) return;
      playIndex(next);
    },
    [n, playIndex]
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

  function stopPlayback() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setCurrentTime(0);
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
    markStatus(index, "idle");
  }

  async function prewarmAll() {
    if (prewarming) {
      abortJob();
      return;
    }
    if (exporting) return;
    const ac = new AbortController();
    jobAbortRef.current = ac;
    setError(null);
    setPrewarming(true);
    setPrewarmDone(0);
    setPrewarmFailed(0);
    let failed = 0;
    const outcome: Record<number, SegStatus> = {};
    try {
      await mapPool(
        n,
        TTS_CONCURRENCY,
        async (i) => {
          try {
            await ensureAudio(i, false, ac.signal);
            outcome[i] = "ready";
          } catch (e) {
            if (isAbortError(e)) throw e;
            outcome[i] = "error";
            failed += 1;
            setPrewarmFailed(failed);
          }
        },
        (done) => setPrewarmDone(done),
        ac.signal
      );
      const next: Record<number, SegStatus> = { ...outcome };
      for (let i = 0; i < n; i++) {
        if (urlsRef.current[keyOf(i)]) next[i] = "ready";
      }
      setStatus(next);
      if (failed > 0) {
        setError(`预缓存完成，但有 ${failed} 段失败（红点）。导出前请重试失败段或点「预缓存全部」。`);
      }
    } catch (e) {
      if (isAbortError(e)) {
        flashNotice("已停止预缓存");
      } else {
        setError(`预缓存失败：${e instanceof Error ? e.message : e}`);
      }
    } finally {
      if (jobAbortRef.current === ac) jobAbortRef.current = null;
      setPrewarming(false);
    }
  }

  /** 优先用播放器内存里已缓存的段落拼接；缺的再走 /api/tts（磁盘缓存或 Fish）。 */
  async function exportMp3() {
    if (exporting) {
      abortJob();
      return;
    }
    if (prewarming) return;
    const ac = new AbortController();
    jobAbortRef.current = ac;
    setError(null);
    setExporting(true);
    setExportDone(0);
    try {
      const parts = await mapPool(
        n,
        TTS_CONCURRENCY,
        async (i) => {
          try {
            const url = await ensureAudio(i, false, ac.signal);
            const buf = await fetch(url, { signal: ac.signal }).then((r) => {
              if (!r.ok) throw new Error(`读取第 ${i + 1} 段音频失败`);
              return r.arrayBuffer();
            });
            return buf;
          } catch (e) {
            if (isAbortError(e)) throw e;
            throw new Error(
              `第 ${i + 1} 段无法导出：${e instanceof Error ? e.message : e}`
            );
          }
        },
        (done) => setExportDone(done),
        ac.signal
      );
      if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
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
      if (isAbortError(e)) {
        flashNotice("已停止导出");
      } else {
        setError(`导出失败：${e instanceof Error ? e.message : e}`);
      }
    } finally {
      if (jobAbortRef.current === ac) jobAbortRef.current = null;
      setExporting(false);
    }
  }

  // 切换节目：重置播放器，并核对服务端磁盘缓存以恢复「已缓存」标记
  useEffect(() => {
    abortJob();
    clearNoticeTimer();
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
    setNotice(null);
    setPrewarming(false);
    setPrewarmDone(0);
    setPrewarmFailed(0);
    setExporting(false);
    setExportDone(0);
    setCurrentTime(0);
    setSegmentDuration(0);

    const segs = episode.script?.segments ?? [];
    if (segs.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const items = segs.map((seg) => {
          const c = characters.find((ch) => ch.id === seg.speaker);
          return {
            text: seg.text,
            voiceId: c?.voiceId || undefined,
            speed: c?.speed,
          };
        });
        const chunk = 80;
        const hits: boolean[] = [];
        for (let start = 0; start < items.length; start += chunk) {
          const res = await api.checkTtsCache(items.slice(start, start + chunk));
          hits.push(...(res.hits || []));
          if (cancelled) return;
        }
        if (cancelled) return;
        const next: Record<number, SegStatus> = {};
        for (let i = 0; i < hits.length; i++) {
          if (hits[i]) next[i] = "ready";
        }
        setStatus((prev) => {
          // 保留核对期间用户已触发的 loading/ready/error
          const merged = { ...next, ...prev };
          for (let i = 0; i < hits.length; i++) {
            if (hits[i] && merged[i] !== "loading" && merged[i] !== "error") {
              merged[i] = "ready";
            }
          }
          return merged;
        });
      } catch {
        /* ignore — 标记会在播放/预缓存时更新 */
      }
    })();

    return () => {
      cancelled = true;
      clearNoticeTimer();
    };
    // 仅在切换节目时核对；角色音色变更较少，需要时可再点预缓存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id]);

  // 卸载时回收
  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, []);

  if (!episode.script || n === 0) return null;

  const progressDone = exporting ? exportDone : prewarmDone;
  const currentSpeaker =
    current >= 0
      ? characters.find((c) => c.id === segments[current]?.speaker)?.name || "—"
      : "—";

  return (
    <div className="player-panel">
      <DeckPlayer
        key={episode.id}
        title={episode.title || "（未命名节目）"}
        speaker={currentSpeaker}
        playing={playing}
        currentIndex={current}
        total={n}
        currentTime={currentTime}
        segmentDuration={segmentDuration}
        readyCount={readyCount}
        onPlayPause={togglePlay}
        onStop={stopPlayback}
        onPrev={() => playIndex(current <= 0 ? 0 : current - 1)}
        onNext={() => playIndex(current + 1)}
        canPrev={current > 0}
        canNext={current >= 0 && current < n - 1}
        onPrewarm={prewarmAll}
        onExport={exportMp3}
        prewarming={prewarming}
        exporting={exporting}
        progressDone={progressDone}
        progressFailed={prewarmFailed}
        audioEl={audioEl}
        onEject={onEject}
        onPrevEpisode={onPrevEpisode}
        onNextEpisode={onNextEpisode}
        canPrevEpisode={canPrevEpisode}
        canNextEpisode={canNextEpisode}
        notice={notice}
        onScrubBy={scrubBy}
        canScrub={n > 1}
      />

      {error && <p className="error">⚠ {error}</p>}

      <audio
        ref={(el) => {
          audioRef.current = el;
          setAudioEl((prev) => (prev === el ? prev : el));
        }}
        onEnded={onEnded}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration;
          setSegmentDuration(Number.isFinite(d) ? (d as number) : 0);
          setCurrentTime(0);
        }}
        onDurationChange={() => {
          const d = audioRef.current?.duration;
          setSegmentDuration(Number.isFinite(d) ? (d as number) : 0);
        }}
        style={{ display: "none" }}
      />

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

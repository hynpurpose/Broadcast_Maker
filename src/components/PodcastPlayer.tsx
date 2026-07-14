import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, Episode } from "../types";
import { api } from "../api";
import { ScriptView, type SegStatus } from "./ScriptView";

const PREFETCH_AHEAD = 2; // 提前预取后面几段

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
  const [exporting, setExporting] = useState(false);

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
        if (cached) return Promise.resolve(cached);
        const inflight = promisesRef.current[key];
        if (inflight) return inflight;
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
    try {
      for (let i = 0; i < n; i++) await ensureAudio(i).catch(() => {});
    } finally {
      setPrewarming(false);
    }
  }

  async function exportMp3() {
    setError(null);
    setExporting(true);
    try {
      const blob = await api.exportEpisode(episode.id);
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
  }, [episode.id]);

  // 卸载时回收
  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, []);

  const readyCount = Object.values(status).filter((s) => s === "ready").length;

  if (!episode.script || n === 0) return null;

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

        <button className="ghost" onClick={prewarmAll} disabled={prewarming} title="提前生成全部段落配音">
          {prewarming ? `预缓存中… ${readyCount}/${n}` : "⚡ 预缓存全部"}
        </button>
        <button onClick={exportMp3} disabled={exporting} title="把整期合成一个 mp3 下载（会补齐未生成的段落）">
          {exporting ? "导出中…" : "⬇ 导出 mp3"}
        </button>
      </div>

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

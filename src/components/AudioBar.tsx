import { useEffect, useRef, useState, type CSSProperties } from "react";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioBar({
  src,
  autoPlay = false,
  downloadName = "audio.mp3",
}: {
  src: string;
  autoPlay?: boolean;
  downloadName?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dragging = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    audio.load();
    if (autoPlay) {
      const p = audio.play();
      if (p) p.then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [src, autoPlay]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(value, duration || value));
    audio.currentTime = next;
    setCurrent(next);
  }

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="audio-bar">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => {
          if (dragging.current) return;
          setCurrent(audioRef.current?.currentTime || 0);
        }}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration;
          setDuration(Number.isFinite(d) ? (d as number) : 0);
        }}
        onDurationChange={() => {
          const d = audioRef.current?.duration;
          setDuration(Number.isFinite(d) ? (d as number) : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />

      <button type="button" className="audio-bar-play" onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
        {playing ? (
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <rect x="1" y="1" width="3.5" height="10" rx="1" fill="currentColor" />
            <rect x="7.5" y="1" width="3.5" height="10" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2.5 1.2v9.6L11 6z" fill="currentColor" />
          </svg>
        )}
      </button>

      <span className="audio-bar-time">{formatTime(current)}</span>

      <div className="audio-bar-track">
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.01}
          value={duration > 0 ? Math.min(current, duration) : 0}
          disabled={duration <= 0}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            seek(Number((e.target as HTMLInputElement).value));
          }}
          onChange={(e) => {
            const v = Number(e.target.value);
            setCurrent(v);
            if (!dragging.current) seek(v);
          }}
          style={{ "--progress": `${progress}%` } as CSSProperties}
          aria-label="进度"
        />
      </div>

      <span className="audio-bar-time audio-bar-time-end">{formatTime(duration)}</span>

      <a className="audio-bar-download" href={src} download={downloadName} title="下载" aria-label="下载">
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <path
            d="M7 1.5v7.2M4.2 6.5L7 9.3l2.8-2.8M2.5 11.5h9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  );
}

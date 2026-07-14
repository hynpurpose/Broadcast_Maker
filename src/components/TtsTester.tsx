import { useState } from "react";
import type { Character } from "../types";
import { api } from "../api";
import { Select } from "./Select";

const MARKUP_HINTS = ["[pause]", "[long pause]", "[emphasis]", "[laughing]", "[whispering]", "[sad]", "[angry]"];

export function TtsTester({ characters }: { characters: Character[] }) {
  const [voiceId, setVoiceId] = useState<string>("");
  const [text, setText] = useState("大家好，[pause] 欢迎收听本期节目。[emphasis] 今天我们聊点不一样的。");
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = characters.find((c) => c.id === voiceId);

  async function speak() {
    setError(null);
    setLoading(true);
    try {
      const url = await api.tts(text, {
        voiceId: selected?.voiceId || undefined,
        speed: selected?.speed,
      });
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  const selectOptions = [
    { value: "", label: "默认音色（.env 中的 reference_id）" },
    ...characters.map((c) => ({
      value: c.id,
      label: c.name + (c.voiceId ? "" : "（未绑定音色）"),
      disabled: !c.voiceId,
    })),
  ];

  return (
    <div className="card form">
      <h2>试听（Fish Audio）</h2>

      <label>
        用哪个角色的音色
        <Select
          value={voiceId}
          onChange={setVoiceId}
          options={selectOptions}
        />
      </label>

      <label>
        台词（可嵌入 Fish S2 标签）
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      </label>

      <div className="hints">
        {MARKUP_HINTS.map((tag) => (
          <button key={tag} type="button" className="tag" onClick={() => setText((t) => t + " " + tag)}>
            {tag}
          </button>
        ))}
      </div>

      <div className="actions">
        <button className="primary" onClick={speak} disabled={loading || !text.trim()}>
          {loading ? "合成中…" : "▶ 合成并播放"}
        </button>
      </div>

      {error && <p className="error">⚠ {error}</p>}
      {audioUrl && <audio className="player" src={audioUrl} controls autoPlay />}
    </div>
  );
}

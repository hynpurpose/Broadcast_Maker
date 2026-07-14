import { useEffect, useRef, useState } from "react";
import type { Character, Chat, ChatMessage } from "../types";
import { api } from "../api";
import { SCRIPT_MODELS, DEFAULT_MODEL } from "../constants";
import { Select } from "./Select";

export function ChatsPanel({ characters }: { characters: Character[] }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setChats(await api.listChats());
  }
  useEffect(() => {
    refresh();
  }, []);

  const selected = chats.find((c) => c.id === selectedId) || null;

  function togglePick(id: string) {
    setPickedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function handleCreate() {
    setError(null);
    try {
      const chat = await api.createChat({ participantIds: pickedIds, model });
      setPickedIds([]);
      await refresh();
      setSelectedId(chat.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleDelete(id: string) {
    await api.deleteChat(id);
    if (selectedId === id) setSelectedId(null);
    refresh();
  }

  return (
    <div className="layout chat-layout">
      <section className="col">
        <div className="card form">
          <h2>发起新对话</h2>
          <fieldset className="guests">
            <legend>拉哪些角色进聊天室（可多选）</legend>
            {characters.length === 0 && <p className="muted small">先去「角色库」创建角色。</p>}
            {characters.map((c) => (
              <label key={c.id} className="checkbox">
                <input type="checkbox" checked={pickedIds.includes(c.id)} onChange={() => togglePick(c.id)} />
                {c.name}
                {!c.voiceId && <span className="muted small">（未绑定音色，将用默认音色）</span>}
              </label>
            ))}
          </fieldset>
          <label>
            对话模型
            <Select
              value={model}
              onChange={setModel}
              options={SCRIPT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={pickedIds.length === 0} onClick={handleCreate}>
              开始聊天
            </button>
          </div>
          {error && <p className="error">⚠ {error}</p>}
        </div>

        <div className="card">
          <h2>对话列表（{chats.length}）</h2>
          {chats.length === 0 && <p className="muted">还没有对话。</p>}
          <ul className="char-list">
            {chats.map((c) => (
              <li
                key={c.id}
                className={"char-item" + (c.id === selectedId ? " active" : "")}
                onClick={() => setSelectedId(c.id)}
              >
                <div>
                  <strong>{c.title}</strong>
                  <div className="muted small">{c.messages.length} 条消息</div>
                </div>
                <div className="actions" onClick={(ev) => ev.stopPropagation()}>
                  <button className="danger" onClick={() => handleDelete(c.id)}>删除</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="col">
        {selected ? (
          <ChatWindow
            key={selected.id}
            chat={selected}
            characters={characters}
            onChatUpdated={(chat) => setChats((list) => list.map((c) => (c.id === chat.id ? chat : c)))}
          />
        ) : (
          <div className="card">
            <h2>聊天室</h2>
            <p className="muted">发起或选择一个对话。角色会用各自的音色语音回复你。</p>
          </div>
        )}
      </section>
    </div>
  );
}

// Tiny silent WAV used to "unlock" the audio element inside the send gesture,
// so the replies (which arrive ~10s later, after Claude + TTS) can auto-play
// without being blocked by the browser's autoplay policy.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function ChatWindow({
  chat,
  characters,
  onChatUpdated,
}: {
  chat: Chat;
  characters: Character[];
  onChatUpdated: (chat: Chat) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endlessMode, setEndlessMode] = useState(false);
  const [endlessPaused, setEndlessPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const playTokenRef = useRef(0); // invalidates in-flight playback on chat switch/unmount
  const unlockedRef = useRef(false);

  // Must be called synchronously inside a user gesture (click / keydown).
  function unlockAudio() {
    const audio = audioRef.current;
    if (!audio || unlockedRef.current) return;
    audio.src = SILENT_WAV;
    const p = audio.play();
    if (p)
      p.then(() => {
        audio.pause();
        unlockedRef.current = true;
      }).catch(() => {
        /* will retry on next gesture */
      });
  }

  const charOf = (id?: string) => characters.find((c) => c.id === id);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, sending]);

  // Stop audio and reset endless mode when window unmounts or chat switches.
  useEffect(() => {
    setEndlessMode(false);
    setEndlessPaused(false);
    return () => {
      playTokenRef.current++;
      audioRef.current?.pause();
    };
  }, [chat.id]);

  async function playMessages(msgs: ChatMessage[]) {
    const token = ++playTokenRef.current;
    // Kick off all TTS fetches in parallel; play in order.
    const jobs = msgs.map((m) => {
      const c = charOf(m.characterId);
      return { m, url: api.tts(m.text, { voiceId: c?.voiceId || undefined, speed: c?.speed }) };
    });
    for (const job of jobs) {
      if (playTokenRef.current !== token) return;
      let url: string;
      try {
        url = await job.url;
      } catch {
        continue; // skip unspeakable message, keep going
      }
      if (playTokenRef.current !== token) {
        URL.revokeObjectURL(url);
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      setSpeakingId(job.m.id);
      audio.src = url;
      try {
        await audio.play();
        unlockedRef.current = true; // a successful play keeps the element unlocked
        await new Promise<void>((resolve) => {
          const done = () => {
            audio.removeEventListener("ended", done);
            audio.removeEventListener("pause", done);
            resolve();
          };
          audio.addEventListener("ended", done);
          audio.addEventListener("pause", done);
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setError("浏览器拦截了自动播放：点任意一条 ▶ 播放一次后，之后就会自动连播。");
        }
      } finally {
        URL.revokeObjectURL(url);
      }
      if (playTokenRef.current !== token) return;
    }
    setSpeakingId(null);
  }

  async function triggerEndlessNext() {
    if (!endlessMode || endlessPaused || sending) return;
    setSending(true);
    setError(null);
    try {
      const { chat: updated, replies } = await api.sendChatMessage(chat.id, "", true);
      onChatUpdated(updated);
      await playMessages(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setEndlessPaused(true); // auto pause on error
    } finally {
      setSending(false);
    }
  }

  // Endless mode auto-trigger effect
  useEffect(() => {
    if (endlessMode && !endlessPaused && !sending && !speakingId) {
      if (chat.messages.length > 0) {
        const timer = setTimeout(() => {
          triggerEndlessNext();
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [endlessMode, endlessPaused, sending, speakingId, chat.messages.length]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    unlockAudio(); // inside the gesture, before any await
    setError(null);
    setInput("");
    setSending(true);
    // Optimistic append of the user's message.
    onChatUpdated({
      ...chat,
      messages: [
        ...chat.messages,
        { id: "tmp_" + Date.now(), role: "user", text, ts: new Date().toISOString() },
      ],
    });
    try {
      const { chat: updated, replies } = await api.sendChatMessage(chat.id, text);
      onChatUpdated(updated);
      await playMessages(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card chat-window">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
        <h2 style={{ margin: 0 }}>{chat.title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={endlessMode}
              onChange={(e) => {
                setEndlessMode(e.target.checked);
                if (e.target.checked) {
                  setEndlessPaused(false);
                }
              }}
              style={{ width: "auto", margin: 0 }}
            />
            <span style={{ fontWeight: 600, color: endlessMode ? "var(--accent)" : "var(--muted)" }}>
              无尽模式
            </span>
          </label>
          {endlessMode && (
            <button
              onClick={() => setEndlessPaused(!endlessPaused)}
              className={endlessPaused ? "primary" : ""}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                borderRadius: "6px",
                borderColor: endlessPaused ? "var(--accent)" : "var(--border)"
              }}
            >
              {endlessPaused ? "▶ 继续输出" : "⏸ 暂停输出"}
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={listRef}>
        {chat.messages.length === 0 && (
          <p className="muted">说点什么开场吧——被点名的角色一定会回你。</p>
        )}
        {chat.messages.map((m) => {
          const c = charOf(m.characterId);
          const isUser = m.role === "user";
          return (
            <div key={m.id} className={"bubble-row" + (isUser ? " mine" : "")}>
              <div className={"bubble" + (isUser ? " mine" : "") + (speakingId === m.id ? " speaking" : "")}>
                {!isUser && (
                  <div className="bubble-head">
                    <span className="speaker">{c?.name || "角色"}</span>
                    {m.emotion && (
                      <span className="chip" style={{ background: "rgba(248, 113, 113, 0.15)", color: "var(--danger)", margin: "0 4px", padding: "1px 6px", fontSize: "10px" }}>
                        {m.emotion}
                      </span>
                    )}
                    <button
                      className="mini"
                      title="播放这条"
                      onClick={() => playMessages([m])}
                    >
                      ▶
                    </button>
                  </div>
                )}
                <div className="bubble-text">{m.text}</div>
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="bubble-row">
            <div className="bubble typing" style={endlessMode && !endlessPaused ? { color: "var(--danger)" } : undefined}>
              {endlessMode && !endlessPaused ? "角色们正在持续输出中…" : "对方正在输入…"}
            </div>
          </div>
        )}
      </div>

      {error && <p className="error">⚠ {error}</p>}

      <div className="chat-input">
        <textarea
          rows={2}
          value={input}
          placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
        />
        <button className="primary" onClick={send} disabled={sending || !input.trim()}>
          {sending ? "…" : "发送"}
        </button>
      </div>

      <audio ref={audioRef} style={{ display: "none" }} />
    </div>
  );
}

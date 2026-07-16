import { useEffect, useRef, useState } from "react";
import type {
  Character,
  Chat,
  ChatDraft,
  ChatMessage,
  ChatMode,
  LearnerLevel,
  LearningGranularity,
  PartnerThinkingStyle,
} from "../types";
import { api } from "../api";
import {
  SCRIPT_MODELS,
  DEFAULT_MODEL,
  CHAT_MODES,
  DEFAULT_CHAT_MODE,
  LEARNING_GRANULARITIES,
  DEFAULT_LEARNING_GRANULARITY,
  LEARNER_LEVELS,
  DEFAULT_LEARNER_LEVEL,
  PARTNER_THINKING_STYLES,
  DEFAULT_PARTNER_STYLES,
} from "../constants";
import { Select } from "./Select";

export function ChatsPanel({ characters }: { characters: Character[] }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Learning form state
  const [topic, setTopic] = useState("");
  const [materials, setMaterials] = useState("");
  const [materialLinks, setMaterialLinks] = useState("");
  const [goal, setGoal] = useState("");
  const [granularity, setGranularity] = useState<LearningGranularity>(DEFAULT_LEARNING_GRANULARITY);
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>(DEFAULT_LEARNER_LEVEL);
  const [teacherId, setTeacherId] = useState("");
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [partnerStyles, setPartnerStyles] = useState<Record<string, PartnerThinkingStyle>>({});

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

  function togglePartner(id: string) {
    setPartnerIds((ids) => {
      if (ids.includes(id)) {
        const next = ids.filter((x) => x !== id);
        setPartnerStyles((styles) => {
          const copy = { ...styles };
          delete copy[id];
          return copy;
        });
        return next;
      }
      if (ids.length >= 3) return ids;
      const used = new Set(Object.values(partnerStyles));
      const fallback =
        (DEFAULT_PARTNER_STYLES.find((s) => !used.has(s as PartnerThinkingStyle)) as PartnerThinkingStyle) ||
        "challenger";
      setPartnerStyles((styles) => ({ ...styles, [id]: styles[id] || fallback }));
      return [...ids, id];
    });
  }

  function setPartnerStyle(id: string, style: PartnerThinkingStyle) {
    setPartnerStyles((s) => ({ ...s, [id]: style }));
  }

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      let draft: ChatDraft;
      if (mode === "learn") {
        draft = {
          mode: "learn",
          model,
          learning: {
            topic,
            materials,
            materialLinks,
            goal,
            granularity,
            learnerLevel,
            teacherId,
            partnerIds,
            partnerStyles,
          },
        };
      } else {
        draft = { mode: "casual", participantIds: pickedIds, model };
      }
      let chat = await api.createChat(draft);
      if (mode === "learn") {
        const { chat: withPlan } = await api.generateLearningPlan(chat.id);
        chat = withPlan;
      }
      setPickedIds([]);
      setTopic("");
      setMaterials("");
      setMaterialLinks("");
      setGoal("");
      await refresh();
      setSelectedId(chat.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    await api.deleteChat(id);
    if (selectedId === id) setSelectedId(null);
    refresh();
  }

  const canCreate =
    mode === "learn"
      ? Boolean(topic.trim() && teacherId && partnerIds.length >= 1 && partnerIds.length <= 3 && !creating)
      : pickedIds.length > 0 && !creating;

  return (
    <div className="layout chat-layout">
      <section className="col">
        <div className="card form">
          <h2>发起新对话</h2>

          <label>
            对话模式
            <Select
              value={mode}
              onChange={(val) => setMode(val as ChatMode)}
              options={CHAT_MODES.map((m) => ({ value: m.id, label: m.label }))}
            />
          </label>

          {mode === "learn" ? (
            <>
              <label>
                学习主题
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="例：贝叶斯思维入门 / 如何写好产品需求"
                />
              </label>

              <label>
                希望达到的目标
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={2}
                  placeholder="学完后你希望能做什么、理解到什么程度"
                />
              </label>

              <label>
                当前水平
                <Select
                  value={learnerLevel}
                  onChange={(val) => setLearnerLevel(val as LearnerLevel)}
                  options={LEARNER_LEVELS.map((m) => ({ value: m.id, label: m.label }))}
                />
              </label>

              <label>
                学习颗粒度（决定计划精细程度）
                <Select
                  value={granularity}
                  onChange={(val) => setGranularity(val as LearningGranularity)}
                  options={LEARNING_GRANULARITIES.map((m) => ({ value: m.id, label: m.label }))}
                />
              </label>

              <label>
                参考资料
                <textarea
                  value={materials}
                  onChange={(e) => setMaterials(e.target.value)}
                  rows={3}
                  placeholder="笔记、要点、教材摘要、易错点……"
                />
              </label>

              <label>
                参考链接（可选，每行一个）
                <textarea
                  value={materialLinks}
                  onChange={(e) => setMaterialLinks(e.target.value)}
                  rows={2}
                  placeholder="https://..."
                />
              </label>

              <label>
                主讲老师
                <Select
                  value={teacherId}
                  onChange={(val) => {
                    setTeacherId(val);
                    setPartnerIds((ids) => ids.filter((id) => id !== val));
                  }}
                  options={[
                    { value: "", label: "— 选择老师 —" },
                    ...characters.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </label>

              <fieldset className="guests">
                <legend>学习伙伴 Partner（1–3 位，思维风格可不同）</legend>
                {characters.length === 0 && <p className="muted small">先去「角色库」创建角色。</p>}
                <div className="guest-grid">
                  {characters.map((c) => {
                    const picked = partnerIds.includes(c.id);
                    const disabled = c.id === teacherId || (!picked && partnerIds.length >= 3);
                    return (
                      <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <label className="checkbox" data-disabled={disabled || undefined}>
                          <input
                            type="checkbox"
                            checked={picked}
                            disabled={disabled}
                            onChange={() => togglePartner(c.id)}
                          />
                          {c.name}
                          {c.id === teacherId && <span className="muted small">（已是老师）</span>}
                        </label>
                        {picked && (
                          <Select
                            value={partnerStyles[c.id] || "challenger"}
                            onChange={(val) => setPartnerStyle(c.id, val as PartnerThinkingStyle)}
                            options={PARTNER_THINKING_STYLES.map((s) => ({
                              value: s.id,
                              label: s.label,
                            }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            </>
          ) : (
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
          )}

          <label>
            对话模型
            <Select
              value={model}
              onChange={setModel}
              options={SCRIPT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            />
          </label>
          <div className="actions end">
            <button className="primary" disabled={!canCreate} onClick={handleCreate}>
              {creating
                ? mode === "learn"
                  ? "生成学习计划中…"
                  : "创建中…"
                : mode === "learn"
                ? "创建并生成学习计划"
                : "开始聊天"}
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
                  <div className="muted small">
                    {(c.mode || "casual") === "learn" ? "学习" : "闲聊"} · {c.messages.length} 条消息
                    {c.learning?.plan ? ` · 第 ${(c.learning.currentStepIndex || 0) + 1}/${c.learning.plan.steps.length} 步` : ""}
                  </div>
                </div>
                <div className="actions end" onClick={(ev) => ev.stopPropagation()}>
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
            <p className="muted">发起或选择一个对话。学习模式下，老师与伙伴会按计划循序引导你。</p>
          </div>
        )}
      </section>
    </div>
  );
}

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
  const [planBusy, setPlanBusy] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const playTokenRef = useRef(0);
  const unlockedRef = useRef(false);

  const isLearn = chat.mode === "learn";
  const learning = chat.learning;
  const plan = learning?.plan || null;
  const stepIndex = learning?.currentStepIndex || 0;
  const currentStep = plan?.steps?.[stepIndex] || null;

  function unlockAudio() {
    const audio = audioRef.current;
    if (!audio || unlockedRef.current) return;
    audio.src = SILENT_WAV;
    const p = audio.play();
    if (p)
      p.then(() => {
        audio.pause();
        unlockedRef.current = true;
      }).catch(() => {});
  }

  const charOf = (id?: string) => characters.find((c) => c.id === id);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, sending]);

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
        continue;
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
        unlockedRef.current = true;
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
      setEndlessPaused(true);
    } finally {
      setSending(false);
    }
  }

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
    unlockAudio();
    setError(null);
    setInput("");
    setSending(true);
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

  async function regeneratePlan() {
    setPlanBusy(true);
    setError(null);
    try {
      const { chat: updated } = await api.generateLearningPlan(chat.id);
      onChatUpdated(updated);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPlanBusy(false);
    }
  }

  async function advanceStep(stepIndex?: number) {
    setStepBusy(true);
    setError(null);
    try {
      const updated = await api.advanceLearningStep(chat.id, stepIndex);
      onChatUpdated(updated);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setStepBusy(false);
    }
  }

  const styleLabel = (id?: string) =>
    PARTNER_THINKING_STYLES.find((s) => s.id === id)?.label.split(" — ")[0] || id || "";

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
                if (e.target.checked) setEndlessPaused(false);
              }}
              style={{ width: "auto", margin: 0 }}
            />
            <span style={{ fontWeight: 600, color: endlessMode ? "var(--accent)" : "var(--muted)" }}>
              {isLearn ? "继续讲解" : "无尽模式"}
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
                borderColor: endlessPaused ? "var(--accent)" : "var(--border)",
              }}
            >
              {endlessPaused ? "▶ 继续输出" : "⏸ 暂停输出"}
            </button>
          )}
        </div>
      </div>

      {isLearn && learning && (
        <div className="learn-panel">
          <div className="learn-panel-head">
            <div>
              <div className="muted small">学习主题</div>
              <strong>{learning.topic}</strong>
            </div>
            <button type="button" disabled={planBusy} onClick={regeneratePlan}>
              {planBusy ? "生成中…" : plan ? "重新生成计划" : "生成学习计划"}
            </button>
          </div>
          {learning.goal && <p className="muted small">目标：{learning.goal}</p>}
          {plan ? (
            <>
              <p className="small">{plan.summary}</p>
              <ol className="learn-steps">
                {plan.steps.map((s, i) => (
                  <li
                    key={s.id}
                    className={
                      "learn-step" +
                      (i === stepIndex ? " current" : "") +
                      (i < stepIndex ? " done" : "")
                    }
                  >
                    <button
                      type="button"
                      className="learn-step-btn"
                      disabled={stepBusy}
                      onClick={() => advanceStep(i)}
                      title="跳到这一步"
                    >
                      <span className="learn-step-idx">{i + 1}</span>
                      <span>
                        <strong>{s.title}</strong>
                        <span className="muted small" style={{ display: "block" }}>{s.objective}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {currentStep && (
                <div className="learn-current">
                  <div>
                    当前：第 {stepIndex + 1}/{plan.steps.length} 步 · {currentStep.title}
                    {learning.advanceReady && (
                      <span className="chip" style={{ marginLeft: 8 }}>可进入下一步</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={stepBusy || stepIndex >= plan.steps.length - 1}
                    onClick={() => advanceStep()}
                  >
                    {stepIndex >= plan.steps.length - 1 ? "已是最后一步" : "进入下一步"}
                  </button>
                </div>
              )}
              {plan.partnerAssignments?.length > 0 && (
                <p className="muted small">
                  Partner：
                  {plan.partnerAssignments
                    .map((a) => `${charOf(a.characterId)?.name || "?"}（${styleLabel(a.thinkingStyle)}）`)
                    .join(" · ")}
                </p>
              )}
            </>
          ) : (
            <p className="muted small">还没有学习计划，点上方按钮生成后再开始对话。</p>
          )}
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {chat.messages.length === 0 && (
          <p className="muted">
            {isLearn
              ? plan
                ? "跟老师打个招呼，或直接说「从第一步开始」——他们会按计划引导你。"
                : "先生成学习计划，再开始对话。"
              : "说点什么开场吧——被点名的角色一定会回你。"}
          </p>
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
                    <button className="mini" title="播放这条" onClick={() => playMessages([m])}>
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
              {endlessMode && !endlessPaused
                ? isLearn
                  ? "老师正在继续讲解…"
                  : "角色们正在持续输出中…"
                : "对方正在输入…"}
            </div>
          </div>
        )}
      </div>

      {error && <p className="error">⚠ {error}</p>}

      <div className="chat-input">
        <textarea
          rows={2}
          value={input}
          placeholder={
            isLearn
              ? "回答问题、提问、或说「换个例子」…… Enter 发送"
              : "输入消息，Enter 发送（Shift+Enter 换行）"
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending || (isLearn && !plan)}
        />
        <button className="primary" onClick={send} disabled={sending || !input.trim() || (isLearn && !plan)}>
          {sending ? "…" : "发送"}
        </button>
      </div>

      <audio ref={audioRef} style={{ display: "none" }} />
    </div>
  );
}

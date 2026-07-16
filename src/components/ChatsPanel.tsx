import { useEffect, useRef, useState } from "react";
import type {
  Character,
  Chat,
  ChatDraft,
  ChatMessage,
  ChatMode,
  LearnerLevel,
  LearningGranularity,
  LearnPlanProgress,
  PartnerThinkingStyle,
  SearchMode,
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
  SEARCH_MODES,
  DEFAULT_SEARCH_MODE,
} from "../constants";
import { Select } from "./Select";
import { SourcesBlock } from "./SourcesBlock";

function learnPlanProgressText(p: LearnPlanProgress | null): string {
  if (!p) return "准备中…";
  if (p.phase === "fetch_urls") return "抓取参考链接中…";
  if (p.phase === "search") {
    if (p.searchMode === "deep_research") return "Deep Research 调研中…";
    if (p.searchMode === "deep_research_max") return "Deep Research Max 调研中…";
    if (p.searchMode === "google") return "Google Search 搜索中…";
    return "联网搜索资料中…";
  }
  if (p.phase === "plan") return "正在定制学习计划…";
  if (p.phase === "done") return "计划已生成";
  if (p.phase === "error") return p.error || "生成失败";
  return "生成中…";
}

export function ChatsPanel({ characters }: { characters: Character[] }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<LearnPlanProgress | null>(null);

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
  const [searchMode, setSearchMode] = useState<SearchMode>(DEFAULT_SEARCH_MODE);
  const [searchBrief, setSearchBrief] = useState("");

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
    setCreateProgress(null);
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
            searchMode,
            searchBrief,
          },
        };
      } else {
        draft = { mode: "casual", participantIds: pickedIds, model };
      }
      let chat = await api.createChat(draft);
      if (mode === "learn") {
        const { chat: withPlan } = await api.generateLearningPlan(chat.id, {
          onProgress: setCreateProgress,
        });
        chat = withPlan;
      }
      setPickedIds([]);
      setTopic("");
      setMaterials("");
      setMaterialLinks("");
      setGoal("");
      setSearchBrief("");
      setSearchMode(DEFAULT_SEARCH_MODE);
      const list = await api.listChats();
      setChats(list.map((c) => (c.id === chat.id ? chat : c)));
      setSelectedId(chat.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
      setCreateProgress(null);
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
                联网搜索（生成计划前用 Gemini 搜资料，写入参考素材）
                <Select
                  value={searchMode}
                  onChange={(val) => setSearchMode(val as SearchMode)}
                  options={SEARCH_MODES.map((m) => ({ value: m.id, label: m.label }))}
                />
              </label>

              {searchMode !== "off" && (
                <label>
                  调研需求（可选，写清想查什么、关注角度、时效等）
                  <textarea
                    value={searchBrief}
                    onChange={(e) => setSearchBrief(e.target.value)}
                    rows={2}
                    placeholder="例：重点查权威定义、常见误区、入门路径；不要只堆术语"
                  />
                </label>
              )}

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
                  ? learnPlanProgressText(createProgress)
                  : "创建中…"
                : mode === "learn"
                ? searchMode !== "off"
                  ? "搜索资料并生成学习计划"
                  : "创建并生成学习计划"
                : "开始聊天"}
            </button>
          </div>
          {creating && mode === "learn" && createProgress && (
            <p className="muted small" style={{ marginTop: 8 }}>
              {learnPlanProgressText(createProgress)}
              {createProgress.phase === "search" && createProgress.searchMode === "deep_research_max"
                ? "（深研可能需要几分钟，请稍候）"
                : createProgress.phase === "search" && createProgress.searchMode === "deep_research"
                ? "（调研可能稍久，请稍候）"
                : ""}
            </p>
          )}
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const LEARN_ACTIONS: { id: string; label: string }[] = [
  { id: "ask_teacher", label: "问老师" },
  { id: "discuss", label: "发起讨论" },
  { id: "want_example", label: "再举个例子" },
  { id: "too_hard", label: "太难了" },
  { id: "too_easy", label: "太简单" },
  { id: "recap", label: "小结一下" },
];

function messageKind(m: ChatMessage) {
  return m.kind || (m.role === "system" ? "system" : "speech");
}

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
  const [planProgress, setPlanProgress] = useState<LearnPlanProgress | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [staging, setStaging] = useState<Set<string>>(() => new Set());
  const [fillDraft, setFillDraft] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const playTokenRef = useRef(0);
  const unlockedRef = useRef(false);
  const autoTurnRef = useRef<string | null>(null);

  const isLearn = chat.mode === "learn";
  const learning = chat.learning;
  const plan = learning?.plan || null;
  const stepIndex = learning?.currentStepIndex || 0;
  const currentStep = plan?.steps?.[stepIndex] || null;

  const pendingQuiz = isLearn
    ? [...chat.messages]
        .reverse()
        .find((m) => messageKind(m) === "quiz" && (m.quizStatus || "pending") === "pending" && !staging.has(m.id))
    : null;

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
  }, [chat.messages.length, sending, staging.size]);

  useEffect(() => {
    setEndlessMode(false);
    setEndlessPaused(false);
    setStaging(new Set());
    autoTurnRef.current = null;
    return () => {
      playTokenRef.current++;
      audioRef.current?.pause();
    };
  }, [chat.id]);

  async function playOneSpeech(m: ChatMessage) {
    const c = charOf(m.characterId);
    const text = (m.text || "").trim();
    if (!text) {
      await sleep(300);
      return;
    }
    let url: string;
    try {
      url = await api.tts(text, { voiceId: c?.voiceId || undefined, speed: c?.speed });
    } catch {
      await sleep(400);
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      URL.revokeObjectURL(url);
      return;
    }
    setSpeakingId(m.id);
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
  }

  /** Sequentially reveal replies: speech TTS, citation pause, quiz stops the queue. */
  async function revealSequence(replies: ChatMessage[]) {
    if (!replies.length) return;
    const token = ++playTokenRef.current;
    setStaging(new Set(replies.map((r) => r.id)));
    for (const m of replies) {
      if (playTokenRef.current !== token) return;
      setStaging((prev) => {
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
      const kind = messageKind(m);
      if (kind === "speech") {
        await playOneSpeech(m);
      } else if (kind === "citation") {
        await sleep(900);
      } else if (kind === "quiz") {
        setSpeakingId(null);
        return; // wait for answer
      } else {
        await sleep(350);
      }
      if (playTokenRef.current !== token) return;
    }
    setSpeakingId(null);
  }

  async function playMessages(msgs: ChatMessage[]) {
    // Manual ▶ on a single bubble: play speech only
    const speech = msgs.filter((m) => messageKind(m) === "speech" && m.text);
    const token = ++playTokenRef.current;
    for (const m of speech) {
      if (playTokenRef.current !== token) return;
      await playOneSpeech(m);
    }
    setSpeakingId(null);
  }

  async function runLearnTurn(reason = "start_step") {
    setSending(true);
    setError(null);
    unlockAudio();
    try {
      const { chat: updated, replies } = await api.learnTurn(chat.id, { reason });
      onChatUpdated(updated);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  // Auto-open teacher turn when plan exists but no character teaching yet
  useEffect(() => {
    if (!isLearn || !plan || sending || planBusy) return;
    const hasTeaching = chat.messages.some(
      (m) => m.role === "character" && (messageKind(m) === "speech" || messageKind(m) === "citation" || messageKind(m) === "quiz")
    );
    const key = `${chat.id}:${stepIndex}:auto`;
    if (!hasTeaching && autoTurnRef.current !== key) {
      autoTurnRef.current = key;
      runLearnTurn("auto_open");
    }
  }, [isLearn, plan, chat.id, chat.messages.length, stepIndex]);

  async function triggerEndlessNext() {
    if (!endlessMode || endlessPaused || sending || pendingQuiz) return;
    setSending(true);
    setError(null);
    try {
      const { chat: updated, replies } = await api.sendChatMessage(chat.id, "", true);
      onChatUpdated(updated);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setEndlessPaused(true);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (endlessMode && !endlessPaused && !sending && !speakingId && !pendingQuiz && staging.size === 0) {
      if (chat.messages.length > 0) {
        const timer = setTimeout(() => {
          triggerEndlessNext();
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [endlessMode, endlessPaused, sending, speakingId, chat.messages.length, pendingQuiz, staging.size]);

  async function send() {
    const text = input.trim();
    if (!text || sending || pendingQuiz) return;
    unlockAudio();
    setError(null);
    setInput("");
    setSending(true);
    onChatUpdated({
      ...chat,
      messages: [
        ...chat.messages,
        { id: "tmp_" + Date.now(), role: "user", kind: "speech", text, ts: new Date().toISOString() },
      ],
    });
    try {
      const { chat: updated, replies } = await api.sendChatMessage(chat.id, text);
      onChatUpdated(updated);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  async function submitQuiz(messageId: string, response: string, skip = false) {
    if (sending) return;
    unlockAudio();
    setSending(true);
    setError(null);
    try {
      const { chat: updated, replies } = await api.quizAnswer(chat.id, {
        messageId,
        response: skip ? undefined : response,
        skip,
      });
      onChatUpdated(updated);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  async function doLearnAction(action: string) {
    if (sending || pendingQuiz || !plan) return;
    unlockAudio();
    setSending(true);
    setError(null);
    try {
      const { chat: updated, replies } = await api.learnAction(chat.id, action);
      onChatUpdated(updated);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  async function regeneratePlan(forceSearch = false) {
    setPlanBusy(true);
    setPlanProgress(null);
    setError(null);
    try {
      const { chat: updated } = await api.generateLearningPlan(chat.id, {
        forceSearch,
        onProgress: setPlanProgress,
      });
      onChatUpdated(updated);
      autoTurnRef.current = null;
      setPlanProgress(null);
      const { chat: opened, replies } = await api.learnTurn(updated.id, { reason: "plan_ready" });
      onChatUpdated(opened);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPlanBusy(false);
      setPlanProgress(null);
    }
  }

  async function advanceStep(nextIndex?: number) {
    setStepBusy(true);
    setError(null);
    unlockAudio();
    try {
      const updated = await api.advanceLearningStep(chat.id, nextIndex);
      onChatUpdated(updated);
      autoTurnRef.current = null;
      const { chat: opened, replies } = await api.learnTurn(updated.id, {
        reason: nextIndex === undefined ? "next_step" : "jump_step",
      });
      onChatUpdated(opened);
      await revealSequence(replies);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setStepBusy(false);
    }
  }

  const styleLabel = (id?: string) =>
    PARTNER_THINKING_STYLES.find((s) => s.id === id)?.label.split(" — ")[0] || id || "";

  const visibleMessages = chat.messages.filter((m) => !staging.has(m.id));

  function renderMessage(m: ChatMessage) {
    const kind = messageKind(m);
    if (kind === "system" || m.role === "system") {
      return (
        <div key={m.id} className="bubble-row system">
          <div className="bubble system">{m.text}</div>
        </div>
      );
    }
    const c = charOf(m.characterId);
    const isUser = m.role === "user";

    if (kind === "citation") {
      const cit = m.citation;
      return (
        <div key={m.id} className="bubble-row">
          <div className={"bubble citation" + (speakingId === m.id ? " speaking" : "")}>
            <div className="bubble-head">
              <span className="speaker">{c?.name || "老师"}</span>
              <span className="chip citation-chip">引用</span>
            </div>
            {m.text && <div className="bubble-text muted small">{m.text}</div>}
            <div className="citation-card">
              <div className="citation-title">
                {cit?.url ? (
                  <a href={cit.url} target="_blank" rel="noreferrer">
                    {cit.title || "参考材料"}
                  </a>
                ) : (
                  cit?.title || "参考材料"
                )}
              </div>
              {cit?.excerpt && <blockquote className="citation-excerpt">{cit.excerpt}</blockquote>}
              {cit?.note && <div className="muted small">{cit.note}</div>}
            </div>
          </div>
        </div>
      );
    }

    if (kind === "quiz") {
      const q = m.quiz;
      const status = m.quizStatus || "pending";
      const pending = status === "pending";
      return (
        <div key={m.id} className="bubble-row">
          <div className="bubble quiz">
            <div className="bubble-head">
              <span className="speaker">{c?.name || "老师"}</span>
              <span className="chip quiz-chip">
                {q?.quizType === "truefalse" ? "判断题" : q?.quizType === "fill" ? "填空题" : "选择题"}
              </span>
            </div>
            {m.text && <div className="bubble-text">{m.text}</div>}
            <div className="quiz-prompt">{q?.prompt}</div>
            {pending ? (
              <div className="quiz-actions">
                {q?.quizType === "fill" ? (
                  <>
                    <input
                      className="quiz-fill"
                      value={fillDraft[m.id] || ""}
                      onChange={(e) => setFillDraft((d) => ({ ...d, [m.id]: e.target.value }))}
                      placeholder="写下你的答案"
                      disabled={sending}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={sending || !(fillDraft[m.id] || "").trim()}
                      onClick={() => submitQuiz(m.id, (fillDraft[m.id] || "").trim())}
                    >
                      提交
                    </button>
                  </>
                ) : (
                  (q?.options || []).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className="quiz-option"
                      disabled={sending}
                      onClick={() => submitQuiz(m.id, opt)}
                    >
                      {opt}
                    </button>
                  ))
                )}
                <button type="button" className="quiz-skip" disabled={sending} onClick={() => submitQuiz(m.id, "", true)}>
                  跳过
                </button>
              </div>
            ) : (
              <div className="quiz-result muted small">
                {status === "skipped"
                  ? "已跳过"
                  : `你的作答：${m.quizResponse || ""}`}
                {status === "answered" && q?.answer && (
                  <div>参考答案：{q.answer}</div>
                )}
                {q?.explanation && status !== "pending" && <div>{q.explanation}</div>}
              </div>
            )}
          </div>
        </div>
      );
    }

    // speech (default)
    return (
      <div key={m.id} className={"bubble-row" + (isUser ? " mine" : "")}>
        <div className={"bubble" + (isUser ? " mine" : "") + (speakingId === m.id ? " speaking" : "")}>
          {!isUser && (
            <div className="bubble-head">
              <span className="speaker">{c?.name || "角色"}</span>
              {m.emotion && (
                <span
                  className="chip"
                  style={{
                    background: "rgba(248, 113, 113, 0.15)",
                    color: "var(--danger)",
                    margin: "0 4px",
                    padding: "1px 6px",
                    fontSize: "10px",
                  }}
                >
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
  }

  return (
    <div className="card chat-window">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "12px",
        }}
      >
        <h2 style={{ margin: 0 }}>{chat.title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              margin: 0,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={endlessMode}
              onChange={(e) => {
                setEndlessMode(e.target.checked);
                if (e.target.checked) setEndlessPaused(false);
              }}
              style={{ width: "auto", margin: 0 }}
              disabled={Boolean(pendingQuiz)}
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
              {(learning.searchMode || "off") !== "off" && (
                <div className="muted small" style={{ marginTop: 4 }}>
                  联网：
                  {SEARCH_MODES.find((m) => m.id === learning.searchMode)?.label || learning.searchMode}
                  {learning.searchDone ? " · 已搜" : " · 待搜"}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" disabled={planBusy || sending} onClick={() => regeneratePlan(false)}>
                {planBusy
                  ? learnPlanProgressText(planProgress)
                  : plan
                  ? "重新生成计划"
                  : "生成学习计划"}
              </button>
              {(learning.searchMode || "off") !== "off" && (
                <button type="button" disabled={planBusy || sending} onClick={() => regeneratePlan(true)}>
                  {planBusy && (planProgress?.phase === "search" || planProgress?.phase === "fetch_urls")
                    ? learnPlanProgressText(planProgress)
                    : planBusy
                    ? "处理中…"
                    : "重新搜索并生成"}
                </button>
              )}
            </div>
          </div>
          {planBusy && planProgress && (
            <p className="muted small">{learnPlanProgressText(planProgress)}</p>
          )}
          {learning.goal && <p className="muted small">目标：{learning.goal}</p>}
          {learning.searchSources && learning.searchSources.length > 0 && (
            <SourcesBlock sources={learning.searchSources} />
          )}
          {plan ? (
            <>
              <p className="small">{plan.summary}</p>
              <ol className="learn-steps">
                {plan.steps.map((s, i) => (
                  <li
                    key={s.id}
                    className={
                      "learn-step" + (i === stepIndex ? " current" : "") + (i < stepIndex ? " done" : "")
                    }
                  >
                    <button
                      type="button"
                      className="learn-step-btn"
                      disabled={stepBusy || sending}
                      onClick={() => advanceStep(i)}
                      title="跳到这一步"
                    >
                      <span className="learn-step-idx">{i + 1}</span>
                      <span>
                        <strong>{s.title}</strong>
                        <span className="muted small" style={{ display: "block" }}>
                          {s.objective}
                        </span>
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
                      <span className="chip" style={{ marginLeft: 8 }}>
                        可进入下一步
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!chat.messages.some((m) => m.role === "character") && (
                      <button type="button" disabled={sending || stepBusy} onClick={() => runLearnTurn("manual_start")}>
                        开始本步
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      disabled={stepBusy || sending || stepIndex >= plan.steps.length - 1}
                      onClick={() => advanceStep()}
                    >
                      {stepIndex >= plan.steps.length - 1 ? "已是最后一步" : "进入下一步"}
                    </button>
                  </div>
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
            <p className="muted small">还没有学习计划，点上方按钮生成后再开始。</p>
          )}
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {visibleMessages.length === 0 && !sending && (
          <p className="muted">
            {isLearn
              ? plan
                ? "老师正在准备开场讲解…"
                : "先生成学习计划，再开始对话。"
              : "说点什么开场吧——被点名的角色一定会回你。"}
          </p>
        )}
        {visibleMessages.map(renderMessage)}
        {sending && staging.size === 0 && (
          <div className="bubble-row">
            <div
              className="bubble typing"
              style={endlessMode && !endlessPaused ? { color: "var(--danger)" } : undefined}
            >
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

      {isLearn && plan && (
        <div className="learn-action-bar">
          {LEARN_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="learn-action"
              disabled={sending || Boolean(pendingQuiz)}
              onClick={() => doLearnAction(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {pendingQuiz && (
        <p className="muted small" style={{ marginBottom: 8 }}>
          请先完成或跳过当前测验，再继续聊天。
        </p>
      )}

      <div className="chat-input">
        <textarea
          rows={2}
          value={input}
          placeholder={
            pendingQuiz
              ? "请先作答上方测验…"
              : isLearn
              ? "提问、讨论、或说「换个例子」…… Enter 发送"
              : "输入消息，Enter 发送（Shift+Enter 换行）"
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending || (isLearn && !plan) || Boolean(pendingQuiz)}
        />
        <button
          className="primary"
          onClick={send}
          disabled={sending || !input.trim() || (isLearn && !plan) || Boolean(pendingQuiz)}
        >
          {sending ? "…" : "发送"}
        </button>
      </div>

      <audio ref={audioRef} style={{ display: "none" }} />
    </div>
  );
}

// Claude-driven multi-character group chat (实时对话).
// One call per user message: Claude role-plays ALL participants and returns
// 1-3 short in-character replies as JSON. Replies are then voiced via the
// existing Fish TTS path on the client.

import { callClaudeJson } from "./claude.js";

const CHAT_SYSTEM = `你是一个多角色群聊扮演引擎。用户正在一个聊天室里和下面这些角色实时聊天，你负责扮演**所有角色**。

## 扮演要求
- 每个角色都有「性格特点」「语言特色/口头禅」「观点阵营/立场」「默认情感基调」，回复必须严格贴合人设——立场对立的角色该抬杠就抬杠，有口头禅的自然带出。
- 这是**即时闲聊**，不是播客稿：每条回复要短（1~3 句话），口语化，像发微信语音。多用语气词（嗯、诶、哈、啊、就是说、对吧……），可以笑、可以叹气、可以反问。
- 角色之间可以互相接话、拆台、附和，不只是各自回答用户。

## 谁来回复
每次用户发言后，由**最有话说的 1~3 个角色**回复（谁被点名谁必须回；话题跟谁的立场相关谁积极；其他人可以沉默）。不要每次所有人都说话，也不要总是同一个人说。

## Fish Audio 语音标签
回复会合成语音，可适度嵌入：[pause]、[laughing]、[chuckles]、[sighs]、[gasps]、[whispering]、[excited]、[angry]、[hesitates]、[emphasis]。贴合情绪、点到为止。

## 情绪连续性
每条回复都要给出该角色**此刻的情绪状态**（emotion 字段，2~6 个字，如：愤怒、轻蔑、嫌弃、兴奋、平静、不耐烦）。情绪要有惯性：上一轮生气的角色这一轮不会无缘无故消气，除非用户说了什么真正改变局面的话。

## 输出格式（严格遵守）
只输出一个 JSON 对象，从 { 开始到 } 结束，不要解释、不要代码块包裹：
{ "replies": [ { "speaker": "角色的id", "text": "这条回复（含标签）", "emotion": "此刻情绪" } ] }
speaker 必须严格使用角色 id。replies 按说话顺序排列，1~3 条。

## 关于引号（极其重要，违反会导致整个结果作废）
text 内部如需引用或强调，**一律用中文全角引号“”或「」，绝对禁止英文半角双引号 "**（会破坏 JSON）。不要未转义反斜杠，每条 text 单行无换行。`;

const MAX_TRANSCRIPT_CHARS = 6000;

export async function generateChatReplies(chat, characters, messages, isEndless = false) {
  const model = chat.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const byId = new Map(characters.map((c) => [c.id, c]));
  const nameOf = (id) => byId.get(id)?.name || "某角色";

  const roster = characters
    .map(
      (c) =>
        `- id: ${c.id}\n  姓名: ${c.name}\n  性格特点: ${c.persona || "（未设置）"}\n` +
        `  语言特色/口头禅: ${c.languageStyle || "（未设置）"}\n  观点阵营/立场: ${c.faction || "（未设置）"}\n` +
        `  默认情感基调: ${c.defaultEmotion || "（未设置）"}`
    )
    .join("\n");

  // Recent transcript, capped so long chats don't blow up the prompt.
  let transcript = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const line = (m.role === "user"
      ? `用户：${m.text}`
      : `${nameOf(m.characterId)}（情绪：${m.emotion || "默认"}）：${m.text}`) + "\n";
    if (transcript.length + line.length > MAX_TRANSCRIPT_CHARS) break;
    transcript = line + transcript;
  }

  const transcriptHeader = isEndless
    ? `## 最近的聊天记录（当前处于无尽模式，角色们正在持续输出/回应用户的上一条消息）`
    : `## 最近的聊天记录（最后一条是用户刚说的话）`;

  const endlessPrompt = isEndless
    ? `\n\n【重要要求】：当前处于**无尽模式**。用户当前没有发表新言论。请保持角色们在上一轮对话中的情绪状态（例如很生气、很轻视、很讨厌、很兴奋等状态，情绪要有极强的惯性和连续性，绝对不要轻易消气或平复），继续针对用户的上一条消息进行回应、说教、吐槽或互相讨论，并持续对用户进行情绪化的输出。
【重要限制突破】：在无尽模式下，请一次性输出 5~10 条不同角色之间的连续对话（在 replies 中返回 5~10 个回复对象），打破 1~3 条的常规限制。角色们可以互相接话、互相拱火、甚至联合起来针对用户的上一条消息进行连环输出，形成紧凑的连击！每条回复必须极其短小精悍（控制在 1~2 句话内，句式口语化、短小，绝不拖泥带水），以保证生成速度极快！`
    : ``;

  const user =
    `## 聊天室里的角色\n${roster}\n\n` +
    `${transcriptHeader}\n${transcript}\n` +
    `现在请让最合适的 1~3 个角色接着回复，直接输出 JSON。${endlessPrompt}`;

  const { json, text } = await callClaudeJson({ model, system: CHAT_SYSTEM, user, maxTokens: 2000 });
  if (!json || !Array.isArray(json.replies)) {
    throw new Error(`角色回复解析失败：${String(text).slice(0, 150)}`);
  }
  const maxReplies = isEndless ? 10 : 3;
  return json.replies
    .filter((r) => r && byId.has(r.speaker) && r.text)
    .slice(0, maxReplies)
    .map((r) => ({
      characterId: r.speaker,
      text: String(r.text),
      emotion: r.emotion ? String(r.emotion) : "",
    }));
}

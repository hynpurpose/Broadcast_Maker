// Claude-driven multi-character group chat (实时对话).
// One call per user message: Claude role-plays ALL participants and returns
// short in-character replies as JSON. Replies are then voiced via the
// existing Fish TTS path on the client.
//
// Modes:
//  - casual: free-form group chat
//  - learn: teacher + partners guide the user through a learning plan

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

const LEARN_SYSTEM = `你是一个多角色「学习陪伴」引擎。用户在学习一个主题，你要扮演老师和各位学习伙伴（partner），用**口语短对话**循序渐进地引导用户掌握内容。

## 角色分工
- **老师（teacher）**：主讲与节奏控制。讲解要清晰、可检验；根据用户回答判断是否掌握，再决定停留、换角度，或推进到下一步。不要一次塞太多。
- **Partner**：按各自「思维风格」插话——质疑、类比、催实践、做总结、或唱反调。Partner 不是第二老师，是帮用户想明白的人；每次 0~2 个 partner 开口即可。

## 教学原则
- 严格围绕「当前学习步骤」推进，不要跳步，也不要提前剧透后面整章。
- 先激活已知 → 讲清一点 → 举一例 → 让用户动手/回答 → 根据回答反馈。
- 用户答错或含糊：先肯定努力，再拆错因，换例子；不要嘲讽打击。
- 用户明显已掌握本步（能用自己的话复述/做对练习）：老师明确表扬，并自然引向下一步（或说可以点「进入下一步」）。
- 参考材料优先；材料不足时可用常识补，但要标明是推断/常识。
- 每条回复短（1~3 句），像语音聊天，不要长篇讲义。

## Fish Audio 语音标签
可适度嵌入：[pause]、[laughing]、[chuckles]、[sighs]、[gasps]、[whispering]、[excited]、[hesitates]、[emphasis]。点到为止。

## 情绪字段
每条回复给 emotion（2~6 字），贴合教学场景：鼓励、耐心、认真、欣慰、好奇……

## 输出格式（严格遵守）
只输出一个 JSON 对象，从 { 开始到 } 结束，不要解释、不要代码块：
{
  "replies": [ { "speaker": "角色的id", "text": "回复（含标签）", "emotion": "此刻情绪" } ],
  "stepStatus": "teaching" | "checking" | "mastered" | "stuck",
  "advanceReady": true/false
}
speaker 必须是角色 id。replies 1~4 条，老师通常要出场。
- stepStatus：本轮教学状态。
- advanceReady：若用户已掌握当前步、可以进入下一步，则为 true（否则 false）。不要仅因用户客气说「懂了」就 true，要有实质证据。

## 关于引号（极其重要）
text 内一律用中文全角引号“”或「」，禁止英文半角双引号 "。每条 text 单行无换行。`;

const PLAN_SYSTEM = `你是学习规划师。根据用户的主题、目标、水平与颗粒度，为一场「老师+伙伴陪伴学习」定制分步计划。
只输出一个 JSON 对象，从 { 开始到 } 结束，不要解释、不要代码块。结构：
{
  "title": "计划标题",
  "summary": "一两句说明整体路径",
  "estimatedRounds": 12,
  "steps": [
    {
      "id": "s1",
      "title": "步骤短标题",
      "objective": "学完这一步应能……",
      "keyPoints": ["要点1", "要点2"],
      "checkHint": "如何判断已掌握（给老师看）"
    }
  ],
  "partnerAssignments": [
    {
      "characterId": "角色id",
      "thinkingStyle": "challenger|analogist|pragmatist|synthesizer|devil",
      "duty": "在本计划中的具体职责一句话"
    }
  ]
}

## 颗粒度与步数（必须遵守）
- coarse：恰好 3~5 步
- medium：恰好 6~10 步
- fine：恰好 10~16 步
步与步之间有递进，最后一步做综合回顾或小挑战。

## Partner 分配
为每位 partner 指定 thinkingStyle（尽量互不重复），duty 要结合其人设与主题写具体。thinkingStyle 若用户已指定则优先沿用。

## 关于引号
所有字符串内一律用中文全角引号“”或「」，禁止英文半角双引号 "。`;

const MAX_TRANSCRIPT_CHARS = 6000;

const STYLE_LABELS = {
  challenger: "质疑者（追问漏洞）",
  analogist: "类比者（生活例子）",
  pragmatist: "实践者（怎么用怎么练）",
  synthesizer: "总结者（框架与对照）",
  devil: "唱反调（抬杠加深印象）",
};

const GRANULARITY_HINT = {
  coarse: "粗颗粒：3~5 大步",
  medium: "中等：6~10 步",
  fine: "细颗粒：10~16 步",
};

const LEVEL_HINT = {
  beginner: "零基础",
  intermediate: "有一些基础",
  advanced: "想深入/查漏补缺",
};

function describeCharacter(c) {
  return (
    `- id: ${c.id}\n  姓名: ${c.name}\n  性格特点: ${c.persona || "（未设置）"}\n` +
    `  语言特色/口头禅: ${c.languageStyle || "（未设置）"}\n  观点阵营/立场: ${c.faction || "（未设置）"}\n` +
    `  过往经历: ${c.backstory || "（未设置）"}\n` +
    `  默认情感基调: ${c.defaultEmotion || "（未设置）"}`
  );
}

function buildTranscript(messages, nameOf) {
  let transcript = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const line =
      (m.role === "user"
        ? `用户：${m.text}`
        : `${nameOf(m.characterId)}（情绪：${m.emotion || "默认"}）：${m.text}`) + "\n";
    if (transcript.length + line.length > MAX_TRANSCRIPT_CHARS) break;
    transcript = line + transcript;
  }
  return transcript;
}

function defaultPartnerStyles(partnerIds, preferred = {}) {
  const order = ["challenger", "analogist", "pragmatist", "synthesizer", "devil"];
  const used = new Set();
  const out = {};
  for (const id of partnerIds) {
    const pref = preferred[id];
    if (pref && order.includes(pref) && !used.has(pref)) {
      out[id] = pref;
      used.add(pref);
    }
  }
  let i = 0;
  for (const id of partnerIds) {
    if (out[id]) continue;
    while (i < order.length && used.has(order[i])) i++;
    const style = order[i] || order[i % order.length];
    out[id] = style;
    used.add(style);
    i++;
  }
  return out;
}

/**
 * Generate a structured learning plan for a learn-mode chat.
 */
export async function generateLearningPlan(chat, characters) {
  const learning = chat.learning;
  if (!learning) throw new Error("该对话不是学习模式");

  const byId = new Map(characters.map((c) => [c.id, c]));
  const teacher = byId.get(learning.teacherId);
  const partners = (learning.partnerIds || []).map((id) => byId.get(id)).filter(Boolean);
  if (!teacher) throw new Error("未找到主讲老师");
  if (partners.length < 1 || partners.length > 3) {
    throw new Error("学习模式需要 1~3 位 partner");
  }

  const styles = defaultPartnerStyles(learning.partnerIds, learning.partnerStyles || {});
  const model = chat.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const granularity = learning.granularity || "medium";

  const partnerBlock = partners
    .map((p) => {
      const style = styles[p.id];
      return (
        describeCharacter(p) +
        `\n  预设思维风格: ${style}（${STYLE_LABELS[style] || style}）`
      );
    })
    .join("\n");

  const user =
    `请为下面这场学习定制计划。\n\n` +
    `## 学习主题\n${learning.topic || "（未填写）"}\n\n` +
    `## 学习目标\n${learning.goal || "（未填写）"}\n\n` +
    `## 学习者水平\n${LEVEL_HINT[learning.learnerLevel] || learning.learnerLevel}\n\n` +
    `## 计划颗粒度\n${GRANULARITY_HINT[granularity] || granularity}\n\n` +
    `## 参考资料\n${learning.materials || "（无）"}\n\n` +
    (learning.materialLinks
      ? `## 参考链接\n${learning.materialLinks}\n\n`
      : "") +
    `## 老师\n${describeCharacter(teacher)}\n\n` +
    `## Partners\n${partnerBlock}\n\n` +
    `partnerAssignments 里的 characterId 必须使用上面的角色 id，thinkingStyle 优先用已给的预设。\n` +
    `直接输出 JSON。`;

  const { json, text } = await callClaudeJson({
    model,
    system: PLAN_SYSTEM,
    user,
    maxTokens: 8000,
  });
  if (!json || !Array.isArray(json.steps) || json.steps.length === 0) {
    throw new Error(`学习计划生成失败：${String(text).slice(0, 200)}`);
  }

  const steps = json.steps.map((s, i) => ({
    id: String(s.id || `s${i + 1}`),
    title: String(s.title || `步骤 ${i + 1}`),
    objective: String(s.objective || ""),
    keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.map(String) : [],
    checkHint: String(s.checkHint || ""),
  }));

  const assignments = Array.isArray(json.partnerAssignments)
    ? json.partnerAssignments
        .filter((a) => a && byId.has(a.characterId))
        .map((a) => ({
          characterId: String(a.characterId),
          thinkingStyle: styles[a.characterId] || String(a.thinkingStyle || "challenger"),
          duty: String(a.duty || ""),
        }))
    : partners.map((p) => ({
        characterId: p.id,
        thinkingStyle: styles[p.id],
        duty: STYLE_LABELS[styles[p.id]] || "",
      }));

  // Ensure every partner has an assignment
  for (const p of partners) {
    if (!assignments.some((a) => a.characterId === p.id)) {
      assignments.push({
        characterId: p.id,
        thinkingStyle: styles[p.id],
        duty: STYLE_LABELS[styles[p.id]] || "",
      });
    }
  }

  return {
    title: String(json.title || learning.topic || "学习计划"),
    summary: String(json.summary || ""),
    estimatedRounds: Math.max(1, Number(json.estimatedRounds) || steps.length * 2),
    steps,
    partnerAssignments: assignments,
  };
}

export async function generateChatReplies(chat, characters, messages, isEndless = false) {
  if (chat.mode === "learn" && chat.learning) {
    return generateLearnReplies(chat, characters, messages, isEndless);
  }
  return generateCasualReplies(chat, characters, messages, isEndless);
}

async function generateCasualReplies(chat, characters, messages, isEndless = false) {
  const model = chat.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const byId = new Map(characters.map((c) => [c.id, c]));
  const nameOf = (id) => byId.get(id)?.name || "某角色";

  const roster = characters.map(describeCharacter).join("\n");
  const transcript = buildTranscript(messages, nameOf);

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
  return {
    replies: json.replies
      .filter((r) => r && byId.has(r.speaker) && r.text)
      .slice(0, maxReplies)
      .map((r) => ({
        characterId: r.speaker,
        text: String(r.text),
        emotion: r.emotion ? String(r.emotion) : "",
      })),
    advanceReady: false,
    stepStatus: null,
  };
}

async function generateLearnReplies(chat, characters, messages, isEndless = false) {
  const learning = chat.learning;
  const model = chat.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const byId = new Map(characters.map((c) => [c.id, c]));
  const nameOf = (id) => byId.get(id)?.name || "某角色";

  const teacher = byId.get(learning.teacherId);
  const partners = (learning.partnerIds || []).map((id) => byId.get(id)).filter(Boolean);
  const plan = learning.plan;
  const stepIndex = Math.max(0, Number(learning.currentStepIndex) || 0);
  const step = plan?.steps?.[stepIndex] || null;
  const assignments = plan?.partnerAssignments || [];

  const teacherBlock = teacher
    ? describeCharacter(teacher) + `\n  本场身份: 老师（主讲）`
    : "（未指定老师）";

  const partnerBlock = partners
    .map((p) => {
      const a = assignments.find((x) => x.characterId === p.id);
      const style = a?.thinkingStyle || learning.partnerStyles?.[p.id] || "challenger";
      return (
        describeCharacter(p) +
        `\n  本场身份: Partner\n  思维风格: ${style}（${STYLE_LABELS[style] || style}）\n` +
        `  职责: ${a?.duty || STYLE_LABELS[style] || ""}`
      );
    })
    .join("\n");

  const planBlock = plan
    ? `## 整体学习计划\n标题：${plan.title}\n概要：${plan.summary}\n` +
      plan.steps
        .map(
          (s, i) =>
            `${i === stepIndex ? "👉" : "  "} ${i + 1}. ${s.title} — ${s.objective}`
        )
        .join("\n")
    : `## 学习计划\n（尚未生成，请先围绕主题做轻量引导，并提醒用户生成计划）`;

  const stepBlock = step
    ? `## 当前步骤（第 ${stepIndex + 1}/${plan.steps.length} 步）\n` +
      `标题：${step.title}\n目标：${step.objective}\n` +
      `要点：${(step.keyPoints || []).join("；") || "（无）"}\n` +
      `掌握检验：${step.checkHint || "（无）"}\n`
    : "";

  const transcript = buildTranscript(messages, nameOf);
  const transcriptHeader = isEndless
    ? `## 最近对话（无尽模式：用户未发言，请老师/伙伴继续围绕当前步骤讲解或给小练习）`
    : `## 最近对话（最后一条是用户刚说的话）`;

  const endlessHint = isEndless
    ? `\n当前为无尽模式：用户没说话。请继续当前步骤的讲解/追问/举例，输出 3~6 条短回复，推进理解，不要跳步。`
    : "";

  const user =
    `## 学习主题\n${learning.topic || "（未填写）"}\n\n` +
    `## 学习目标\n${learning.goal || "（未填写）"}\n\n` +
    `## 学习者水平\n${LEVEL_HINT[learning.learnerLevel] || learning.learnerLevel}\n\n` +
    `## 参考资料\n${learning.materials || "（无）"}\n\n` +
    `## 老师\n${teacherBlock}\n\n` +
    `## Partners\n${partnerBlock}\n\n` +
    `${planBlock}\n\n` +
    stepBlock +
    `${transcriptHeader}\n${transcript}\n` +
    `请以老师为主、partner 适量配合，围绕【当前步骤】回复。直接输出 JSON。${endlessHint}`;

  const { json, text } = await callClaudeJson({
    model,
    system: LEARN_SYSTEM,
    user,
    maxTokens: isEndless ? 3000 : 2500,
  });
  if (!json || !Array.isArray(json.replies)) {
    throw new Error(`学习回复解析失败：${String(text).slice(0, 150)}`);
  }
  const maxReplies = isEndless ? 6 : 4;
  return {
    replies: json.replies
      .filter((r) => r && byId.has(r.speaker) && r.text)
      .slice(0, maxReplies)
      .map((r) => ({
        characterId: r.speaker,
        text: String(r.text),
        emotion: r.emotion ? String(r.emotion) : "",
      })),
    advanceReady: Boolean(json.advanceReady),
    stepStatus: json.stepStatus ? String(json.stepStatus) : null,
  };
}

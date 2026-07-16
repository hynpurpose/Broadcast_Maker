// Claude client (via apiyi proxy) for generating structured podcast scripts.
// Endpoint: POST {CLAUDE_BASE_URL}/v1/messages  (x-api-key auth, Anthropic native format)
//
// Two strategies:
//  - Single-pass (short episodes): one call produces the whole script.
//  - Segmented (long episodes): one outline call + one call per section, then
//    concatenate. This reliably hits a long target length that a single call
//    would under-deliver on, and keeps each call's output small (no streaming).

const SECTION_MINUTES = 5; // 每个环节约 5 分钟

// Read at call time — .env is loaded after this module is imported.
const wordsPerMinute = () => Number(process.env.WORDS_PER_MINUTE) || 300;

function sectionCountFor(minutes) {
  return Math.min(12, Math.max(1, Math.round((Number(minutes) || 10) / SECTION_MINUTES)));
}

const SYSTEM_PROMPT = `你是一位资深的中文播客编剧。你的任务是为一档多角色播客创作**完整的逐字稿**——每个角色说的每一句话都要完整写出来，不能用“（此处略）”“主持人介绍……”之类的概括。

## 角色职责
- 主持人（host）：负责开场问候、介绍主题与嘉宾、抛出问题、串场与话题转场、控制节奏、以及最后的收尾总结。主持人是穿针引线的人，不长篇大论。
- 嘉宾（guest）：负责输出观点、展开论述、举例。多位嘉宾之间可以有交锋、反驳、补充和附和，让对话自然、有张力。注意让每位嘉宾的发言量大致均衡，别冷落任何一位。

## 每个角色的说话方式
你会收到每个角色的「性格特点」「语言特色/口头禅」「观点阵营/立场」「默认情感基调」。台词必须贴合这些设定——立场对立的角色要真的针锋相对，有口头禅的要自然带出，性格要通过用词和语气体现。

## Fish Audio 语音标签（重要）
最终台词会交给 Fish Audio S2 合成语音。你要在台词中嵌入方括号标签来控制语气、情感、停顿和拟声，让语音生动自然。标签用自然语言描述，紧贴在要生效的文字前面。可用标签（尽量用全，别只用 pause）：
[pause]（短停顿）、[long pause]（长停顿）、[emphasis]（强调）、[laughing]（大笑）、[chuckles]（轻笑/憋笑）、[sighs]（叹气）、[clears throat]（清嗓）、[gasps]（倒吸气/惊讶）、[whispering]（压低声音）、[excited]（兴奋）、[sad]（低落）、[angry]（生气）、[hesitates]（迟疑）。
使用原则：贴合角色性格和当下情绪，在语气转折、强调、卖关子、情绪爆发处最有效；不要每句都堆、也不要连续叠标签。

## 生动、口语化（这是最重要的要求）
这是一档真人感极强的聊天播客，不是播音念稿。务必让它听起来像几个人即兴唠嗑：
- **多用语气词和口头填充**：嗯、诶、哎、啊、呃、哈、嘿、唉、这个、那个、就是说、你懂吧、对吧、话说回来、怎么讲呢……要贴合角色，自然穿插，别机械地每句都加。
- **多笑、多情绪**：该乐的地方就 [laughing] 或 [chuckles]，无奈就 [sighs]，惊讶就 [gasps]，卖关子就 [whispering]+[pause]，激动就 [excited]+[emphasis]。让情绪有明显起伏。
- **多附和、多接话**：适当用「对对对」「是这样」「诶我插一句」「有意思」「等等」这类短反应，让对话你来我往，而不是一人一大段轮流念。
- **句子长短交错**：多用短句、反问、口语化的破句，别都是工整的书面长句。

## 打断（少量，点到为止）
偶尔安排一次角色打断另一个人——被打断者的台词在中途戛然而止、用破折号「——」结尾（不写完整句），紧接着打断者立刻插话接上。**整期只安排 1~2 次左右，绝不能频繁**，且只用在情绪激动、急于反驳或抢着补充的地方才自然。

## 输出格式（严格遵守）
你的回复必须是**且仅是**一个 JSON 对象，从 { 开始、到 } 结束，前后不要有任何解释文字，不要用 markdown 代码块（\`\`\`）包裹。结构如下：
{
  "title": "本期节目标题",
  "segments": [
    { "speaker": "角色的id", "text": "这个角色说的完整台词（含 Fish 标签）", "emotion": "该句整体情绪的简短描述（可选）" }
  ]
}
speaker 字段必须严格使用下面提供的角色 id。segments 按对话顺序排列。

## 关于引号（极其重要，违反会导致整个结果作废）
台词（text 字段）内部如果需要引用、强调或表示书名等，**一律使用中文全角引号“”或「」**，**绝对禁止使用英文半角双引号 "**。因为半角双引号会破坏 JSON 结构。例如：写 所谓的“真实感”，不要写 所谓的"真实感"。同理，台词内不要出现未转义的反斜杠，每段台词写成一行、内部不要有换行。`;

const OUTLINE_SYSTEM = `你是资深播客策划。你要为一期多角色播客设计「分环节大纲」，把整期拆成若干环节，让整期有清晰的推进弧线：开场 → 逐步深入 → 观点交锋/高潮 → 收尾。
只输出一个 JSON 对象，从 { 开始到 } 结束，不要任何解释、不要用代码块包裹。结构如下：
{ "title": "本期节目标题", "sections": [ { "title": "环节小标题", "focus": "这一环节聊什么、要推进到哪、可安排哪些交锋或转折" } ] }
sections 的数量必须严格等于要求的环节数。第一个环节要包含开场与嘉宾介绍，最后一个环节要收尾总结。

## 关于引号（极其重要，违反会导致整个结果作废）
title 和 focus 文字内部如果需要引用或强调，**一律使用中文全角引号“”或「」**，**绝对禁止使用英文半角双引号 "**——因为半角双引号会破坏 JSON 结构。例如写 从“少数人的特权”推向，不要写 从"少数人的特权"推向。也不要出现未转义的反斜杠或换行。`;

const SITCOM_SYSTEM_PROMPT = `你是一位资深的中文有声情景剧编剧。你的任务是创作**完整的逐字对白稿**——旁白与每位主演说的每一句话都要完整写出来，不能用“（此处略）”“两人争执……”之类的概括，也不要写舞台说明当作台词。

## 角色职责
- 旁白 / 主讲人（narrator）：负责场景交代、时间跳跃、气氛铺垫、必要的内心或环境描述。旁白要克制、有画面感，不要抢戏；在关键节点短促点到即可，大部分篇幅留给角色对白。
- 主演（lead）：负责推进剧情的对白与冲突。多位主演之间要有互动、试探、交锋或和解，让每位主演都有戏份，别冷落任何人。

## 每个角色的说话方式
你会收到每个角色的「性格特点」「语言特色/口头禅」「观点阵营/立场」「过往经历」「默认情感基调」。台词必须贴合这些设定——关系紧张的要真有张力，有口头禅的要自然带出，性格要通过用词和语气体现。同时严格遵循用户给出的「故事背景」「人物关系」「情节发展」。

## Fish Audio 语音标签（重要）
最终台词会交给 Fish Audio S2 合成语音。你要在台词中嵌入方括号标签来控制语气、情感、停顿和拟声，让语音生动自然。标签用自然语言描述，紧贴在要生效的文字前面。可用标签（尽量用全，别只用 pause）：
[pause]（短停顿）、[long pause]（长停顿）、[emphasis]（强调）、[laughing]（大笑）、[chuckles]（轻笑/憋笑）、[sighs]（叹气）、[clears throat]（清嗓）、[gasps]（倒吸气/惊讶）、[whispering]（压低声音）、[excited]（兴奋）、[sad]（低落）、[angry]（生气）、[hesitates]（迟疑）。
使用原则：贴合角色性格和当下情绪，在语气转折、强调、卖关子、情绪爆发处最有效；不要每句都堆、也不要连续叠标签。

## 有声剧的生动感（这是最重要的要求）
这是给耳朵听的戏，不是小说朗读：
- **对白为主、旁白为辅**：旁白只在换场、时间跳跃、关键动作/氛围处出现；不要用旁白复述角色刚说过的话。
- **口语、有潜台词**：多用短句、反问、欲言又止；该噎住就噎住，该炸就炸。
- **多情绪起伏**：该乐用 [laughing]/[chuckles]，无奈用 [sighs]，惊讶用 [gasps]，压低用 [whispering]+[pause]，激动用 [excited]+[emphasis]。
- **戏要有推进**：按情节发展写出起因 → 冲突 → 转折 → 收束，不要原地聊天。

## 打断（少量，点到为止）
偶尔安排一次角色打断另一个人——被打断者的台词在中途戛然而止、用破折号「——」结尾，紧接着打断者立刻插话。**整集只安排 1~2 次左右**，只用在情绪激动或抢话处。

## 输出格式（严格遵守）
你的回复必须是**且仅是**一个 JSON 对象，从 { 开始、到 } 结束，前后不要有任何解释文字，不要用 markdown 代码块（\`\`\`）包裹。结构如下：
{
  "title": "本集标题",
  "segments": [
    { "speaker": "角色的id", "text": "这个角色说的完整台词（含 Fish 标签）", "emotion": "该句整体情绪的简短描述（可选）" }
  ]
}
speaker 字段必须严格使用下面提供的角色 id。segments 按演出顺序排列。

## 关于引号（极其重要，违反会导致整个结果作废）
台词（text 字段）内部如果需要引用、强调或表示书名等，**一律使用中文全角引号“”或「」**，**绝对禁止使用英文半角双引号 "**。因为半角双引号会破坏 JSON 结构。同理，台词内不要出现未转义的反斜杠，每段台词写成一行、内部不要有换行。`;

const SITCOM_OUTLINE_SYSTEM = `你是资深有声情景剧策划。你要为一集多角色情景剧设计「分场大纲」，把整集拆成若干场次，让剧情有清晰推进：开场铺垫 → 冲突升温 → 高潮/转折 → 收束。
只输出一个 JSON 对象，从 { 开始到 } 结束，不要任何解释、不要用代码块包裹。结构如下：
{ "title": "本集标题", "sections": [ { "title": "场次小标题", "focus": "这一场发生什么、情绪怎么变、谁和谁碰撞、要推进到哪" } ] }
sections 的数量必须严格等于要求的场次数。第一场要建立场景与人物关系，最后一场要收束本集情节（可留余韵，但本集主线要有结果）。

## 关于引号（极其重要，违反会导致整个结果作废）
title 和 focus 文字内部如果需要引用或强调，**一律使用中文全角引号“”或「」**，**绝对禁止使用英文半角双引号 "**。也不要出现未转义的反斜杠或换行。`;

function isSitcom(episode) {
  return episode?.mode === "sitcom";
}

function systemPromptFor(episode) {
  return isSitcom(episode) ? SITCOM_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

function outlineSystemFor(episode) {
  return isSitcom(episode) ? SITCOM_OUTLINE_SYSTEM : OUTLINE_SYSTEM;
}

/**
 * Smart entry: pick single-pass or segmented based on duration.
 * @param {object} episode
 * @param {Array} characters
 * @param {(p:{phase:string,current?:number,total?:number})=>void} [onProgress]
 * @param {{ resume?: object, onCheckpoint?: (cp:object)=>Promise<void>|void }} [opts]
 */
export async function generateEpisodeScript(episode, characters, onProgress = () => {}, opts = {}) {
  const count = sectionCountFor(episode.durationMinutes);
  if (count <= 1 && !opts.resume?.outline) {
    onProgress({ phase: "single" });
    return generateScript(episode, characters);
  }
  return generateScriptSegmented(episode, characters, count, onProgress, opts);
}

// --- Single-pass ---
export async function generateScript(episode, characters) {
  const model = episode.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const { byId, roster } = buildRoster(episode, characters);
  const targetWords = Math.max(1, Number(episode.durationMinutes) || 10) * wordsPerMinute();
  const sitcom = isSitcom(episode);

  const userMessage =
    (sitcom
      ? `请创作一集有声情景剧的完整逐字稿。\n\n`
      : `请创作一期播客的完整逐字稿。\n\n`) +
    briefBlock(episode) +
    sitcomBlock(episode) +
    priorBlock(episode) +
    `## 必须使用的参考材料\n${episode.materials || "（无）"}\n\n` +
    `## 参与角色\n${roster}\n\n` +
    `## 时长与篇幅\n目标时长约 ${episode.durationMinutes} 分钟，对应总字数约 ${targetWords} 字（所有角色台词字数之和，不含标签）。` +
    `请让总篇幅接近这个目标，自然收放，不要为凑字数而重复啰嗦。\n\n` +
    `现在开始创作，直接输出符合要求的 JSON。`;

  const maxTokens = Math.min(32000, Math.round(targetWords * 3) + 2000);
  const { json, text, stopReason } = await callClaudeJson({
    model,
    system: systemPromptFor(episode),
    user: userMessage,
    maxTokens,
  });
  if (!json || !Array.isArray(json.segments)) {
    throw new Error(
      `无法解析模型返回的脚本 JSON（stop_reason=${stopReason}，长度=${text.length}）。开头片段：${text.slice(0, 200)} …… 结尾片段：${text.slice(-200)}`
    );
  }
  json.segments = json.segments.filter((s) => s && byId.has(s.speaker) && s.text);
  json.truncated = stopReason === "max_tokens";
  return json;
}

// --- Segmented (outline + per-section) ---
async function generateScriptSegmented(episode, characters, sectionCount, onProgress, opts = {}) {
  const model = episode.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const { byId, roster } = buildRoster(episode, characters);
  const targetWords = Math.max(1, Number(episode.durationMinutes) || 10) * wordsPerMinute();
  const onCheckpoint = typeof opts.onCheckpoint === "function" ? opts.onCheckpoint : async () => {};
  const resume = opts.resume || null;

  let outline = resume?.outline || null;
  const allSegments = Array.isArray(resume?.segments) ? [...resume.segments] : [];
  let startIndex = Math.max(0, Number(resume?.nextSectionIndex) || 0);
  let truncated = false;

  if (!outline) {
    onProgress({ phase: "outline", total: sectionCount });
    outline = await generateOutline(episode, roster, sectionCount, targetWords, model);
    startIndex = 0;
    await onCheckpoint({
      outline,
      segments: [],
      nextSectionIndex: 0,
      sectionCount: outline.sections.length,
      scriptTitle: outline.title || episode.title,
    });
  }

  const sections = outline.sections;
  const perSection = Math.max(200, Math.round(targetWords / sections.length));
  let tail = allSegments.slice(-4).map((s) => s.text).join("\n");
  if (tail.length > 1500) tail = tail.slice(-1500);

  for (let i = startIndex; i < sections.length; i++) {
    onProgress({ phase: "section", current: i + 1, total: sections.length });
    const { segments, truncated: t } = await generateSection(episode, roster, byId, {
      outline,
      index: i,
      total: sections.length,
      priorTail: tail,
      sectionTargetWords: perSection,
      model,
    });
    allSegments.push(...segments);
    truncated = truncated || t;
    tail = allSegments.slice(-4).map((s) => s.text).join("\n");
    if (tail.length > 1500) tail = tail.slice(-1500);

    await onCheckpoint({
      outline,
      segments: allSegments,
      nextSectionIndex: i + 1,
      sectionCount: sections.length,
      scriptTitle: outline.title || episode.title,
    });
  }

  return { title: outline.title || episode.title, segments: allSegments, truncated };
}

async function generateOutline(episode, roster, sectionCount, targetWords, model) {
  const sitcom = isSitcom(episode);
  const user =
    (sitcom
      ? `请为下面这集情景剧设计恰好 ${sectionCount} 个场次的大纲。\n\n`
      : `请为下面这期播客设计恰好 ${sectionCount} 个环节的大纲。\n\n`) +
    briefBlock(episode) +
    sitcomBlock(episode) +
    priorBlock(episode, 4000) +
    `## 参考材料\n${episode.materials || "（无）"}\n\n` +
    `## 参与角色\n${roster}\n\n` +
    `## 篇幅\n整${sitcom ? "集" : "期"}约 ${episode.durationMinutes} 分钟、约 ${targetWords} 字，平均分到 ${sectionCount} 个${sitcom ? "场次" : "环节"}。\n\n` +
    `直接输出 JSON。`;
  const { json, text, stopReason } = await callClaudeJson({
    model,
    system: outlineSystemFor(episode),
    user,
    maxTokens: 8000,
  });
  if (!json || !Array.isArray(json.sections) || json.sections.length === 0) {
    throw new Error(
      `分环节大纲生成失败（stop_reason=${stopReason}，长度=${text.length}）。片段：${text.slice(0, 200)}`
    );
  }
  return json;
}

async function generateSection(episode, roster, byId, opts) {
  const { outline, index, total, priorTail, sectionTargetWords, model } = opts;
  const sec = outline.sections[index];
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const sitcom = isSitcom(episode);
  const roleNote = sitcom
    ? isFirst
      ? "这是**开场**：先由旁白交代场景/氛围，再让主演进入情境，自然展开这一场的情节。"
      : isLast
      ? "这是**收束场**：推进完本场冲突后，给出本集结局或余韵；可用短旁白收尾，不要另开新线。"
      : "这是**中间场**：直接接着前文进入本场冲突，不要重新大段交代背景。"
    : isFirst
    ? "这是**开场环节**：先由主持人问候听众、点出本期主题、介绍到场嘉宾，再自然进入这一环节的内容。"
    : isLast
    ? "这是**收尾环节**：聊完这一环节内容后，由主持人做简短总结、自然收尾、和听众道别。"
    : "这是**中间环节**：直接进入内容，不要再重新开场问候或自我介绍。";

  const user =
    (sitcom
      ? `我们正在分场创作一整集有声情景剧，你只负责其中一场的完整台词。\n\n`
      : `我们正在分环节创作一整期播客，你只负责其中一个环节的完整台词。\n\n`) +
    briefBlock(episode) +
    sitcomBlock(episode) +
    priorBlock(episode, 3000) +
    `## 参考材料\n${episode.materials || "（无）"}\n\n` +
    `## 参与角色\n${roster}\n\n` +
    `## 整${sitcom ? "集" : "期"}大纲\n${outline.sections.map((s, i) => `${i + 1}. ${s.title} —— ${s.focus}`).join("\n")}\n\n` +
    `## 你要写的${sitcom ? "场次" : "环节"}\n第 ${index + 1}/${total} 个${sitcom ? "场次" : "环节"}：《${sec.title}》\n要点：${sec.focus}\n${roleNote}\n\n` +
    (priorTail
      ? `## 前文结尾（紧接着往下写，不要重复上面已经说过的内容）\n${priorTail}\n\n`
      : "") +
    `## 本${sitcom ? "场" : "环节"}篇幅\n本${sitcom ? "场" : "环节"}所有台词合计约 ${sectionTargetWords} 字。只写这一个${sitcom ? "场次" : "环节"}，不要写其它${sitcom ? "场次" : "环节"}的内容。\n\n` +
    `直接输出符合格式的 JSON（只含本${sitcom ? "场" : "环节"}的 segments，title 可省略）。`;

  const maxTokens = Math.min(16000, Math.round(sectionTargetWords * 3) + 1500);
  const { json, text, stopReason } = await callClaudeJson({
    model,
    system: systemPromptFor(episode),
    user,
    maxTokens,
  });
  if (!json || !Array.isArray(json.segments)) {
    throw new Error(`第 ${index + 1} 个环节解析失败：${text.slice(0, 150)}`);
  }
  const segments = json.segments.filter((s) => s && byId.has(s.speaker) && s.text);
  return { segments, truncated: stopReason === "max_tokens" };
}

// --- Shared helpers ---
function buildRoster(episode, characters) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const describe = (c, role) =>
    `- id: ${c.id}\n  姓名: ${c.name}\n  身份: ${role}\n  性格特点: ${c.persona || "（未设置）"}\n` +
    `  语言特色/口头禅: ${c.languageStyle || "（未设置）"}\n  观点阵营/立场: ${c.faction || "（未设置）"}\n` +
    `  过往经历: ${c.backstory || "（未设置）"}\n` +
    `  默认情感基调: ${c.defaultEmotion || "（未设置）"}`;

  if (isSitcom(episode)) {
    const narrator = byId.get(episode.narratorId);
    const leads = (episode.leadActorIds || []).map((id) => byId.get(id)).filter(Boolean);
    const roster = [
      narrator ? describe(narrator, "旁白/主讲人") : "（未指定旁白）",
      ...leads.map((a) => describe(a, "主演")),
    ].join("\n");
    return { byId, roster };
  }

  const host = byId.get(episode.hostId);
  const guests = (episode.guestIds || []).map((id) => byId.get(id)).filter(Boolean);
  const roster = [
    host ? describe(host, "主持人") : "（未指定主持人）",
    ...guests.map((g) => describe(g, "嘉宾")),
  ].join("\n");
  return { byId, roster };
}

function briefBlock(episode) {
  if (isSitcom(episode)) {
    const topic = String(episode.topic || "").trim();
    return topic ? `## 本集主题\n${topic}\n\n` : "";
  }
  return `## 本期主题\n${episode.topic || "（未填写）"}\n\n`;
}

function sitcomBlock(episode) {
  if (!isSitcom(episode)) return "";
  return (
    `## 故事背景\n${episode.storyBackground || "（未填写）"}\n\n` +
    `## 人物关系\n${episode.characterRelations || "（未填写）"}\n\n` +
    `## 情节发展\n${episode.plotDevelopment || "（未填写）"}\n\n`
  );
}

function priorBlock(episode, limit) {
  if (!episode.priorContext) return "";
  const body = limit ? episode.priorContext.slice(0, limit) : episode.priorContext;
  const sitcom = isSitcom(episode);
  return (
    (sitcom
      ? `## 往期内容（用于延续与呼应）\n下面是本系列以往几集的台词。请让本集与它们自然衔接：可以呼应人物关系、未解悬念或之前的梗，但**不要照抄**，本集要有新的情节推进。\n`
      : `## 往期节目内容（用于延续与呼应）\n下面是本节目以往几期的台词。请让本期与它们自然衔接：可以适当回顾、呼应或延续之前的观点与梗（比如“上期我们聊到……”），但**不要照抄**，本期要有新的推进。\n`) +
    `${body}\n\n`
  );
}

export async function callClaudeJson({ model, system, user, maxTokens }) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY is not set in .env");
  const baseUrl = process.env.CLAUDE_BASE_URL || "https://api.apiyi.com";

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude request failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Claude returned no text content: " + JSON.stringify(data).slice(0, 500));
  }
  return { json: parseJson(text), text, stopReason: data.stop_reason };
}

function parseJson(raw) {
  if (typeof raw !== "string") return null;
  // Strip any ```json ... ``` fences the model may add despite instructions.
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    // Salvage: extract from the first "{" to the last "}".
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

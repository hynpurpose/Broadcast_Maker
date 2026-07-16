// Gemini client for Google Search grounding and Deep Research — gathers
// reference material for a title/topic before Claude writes the script.
//
// - google: Generative Language API generateContent + google_search tool
// - deep_research / deep_research_max: Interactions API Deep Research agents
//
// GEMINI_BASE_URL lets you point at a proxy; default is Google official.
// The key is sent via the x-goog-api-key header (never in the URL).

import { GoogleGenAI } from "@google/genai";
import { proxyFetch } from "./http.js";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com";
const MATERIALS_SNIPPET_MAX = 12000;
const MAX_MATERIAL_URLS = 20;

const DEEP_AGENTS = {
  deep_research: "deep-research-preview-04-2026",
  deep_research_max: "deep-research-max-preview-04-2026",
};

const SEARCH_HEADINGS = {
  google: "联网搜索到的资料（Google Search）",
  deep_research: "Deep Research 调研报告",
  deep_research_max: "Deep Research Max 调研报告",
};

function requireApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env");
  // HTTP headers must be ASCII; a still-placeholder (Chinese) key would otherwise
  // throw a cryptic ByteString error deep in fetch.
  if (!/^[\x20-\x7E]+$/.test(apiKey)) {
    throw new Error("GEMINI_API_KEY 看起来还是占位符，请在 .env 填入真实的 Google AI Studio key");
  }
  return apiKey;
}

/** Pull visible text from a generateContent response (skip empty / thought-only parts). */
function geminiResponseText(data) {
  const block =
    data?.promptFeedback?.blockReason ||
    data?.candidates?.[0]?.finishReason === "SAFETY"
      ? data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason
      : "";
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  return { text, blockReason: block || "" };
}

/** Tolerant JSON parse for model output (fences, leading prose, trailing junk). */
function parseModelJson(raw) {
  if (typeof raw !== "string") return null;
  let s = raw
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Some models wrap with full-width braces or smart quotes around keys — normalize a bit.
  s = s.replace(/^\uFF5B/, "{").replace(/\uFF5D$/, "}");
  try {
    return JSON.parse(s);
  } catch {
    /* continue */
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = s.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // Common failure: unescaped newlines / quotes inside string values.
      try {
        const repaired = slice
          .replace(/[\u201C\u201D\u201E\u201F]/g, "“")
          .replace(/[\u2018\u2019]/g, "’");
        return JSON.parse(repaired);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Pull a string field from messy model JSON/text when JSON.parse fails. */
function extractJsonStringField(raw, keys) {
  const s = String(raw || "");
  for (const key of keys) {
    if (!key) continue;
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
    const m = s.match(re);
    if (!m) continue;
    try {
      const out = JSON.parse(`"${m[1]}"`);
      if (String(out || "").trim()) return String(out).trim();
    } catch {
      const out = m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
      if (out) return out;
    }
  }
  return "";
}

/**
 * @param {{ title?: string, topic?: string, searchBrief?: string, materials?: string }} ctx
 * @returns {string} structured context block, or "" if nothing usable
 */
export function buildSearchContext(ctx = {}) {
  const title = String(ctx.title || "").trim();
  const topic = String(ctx.topic || "").trim();
  const searchBrief = String(ctx.searchBrief || "").trim();
  const materials = String(ctx.materials || "").trim();

  const parts = [];
  if (title) parts.push(`标题：${title}`);
  if (topic) parts.push(`主题：${topic}`);
  if (searchBrief) parts.push(`调研需求：${searchBrief}`);
  if (materials) {
    let snip = materials;
    if (materials.length > MATERIALS_SNIPPET_MAX) {
      const marker = "## 链接自动抓取";
      const idx = materials.indexOf(marker);
      if (idx >= 0) {
        // Keep some original text + prefer the fetched-link digests.
        const head = materials.slice(0, Math.min(idx, 2000));
        const digests = materials.slice(idx);
        snip =
          (head.length < idx ? head + "\n……（原文过长已截断）\n\n" : head) +
          digests.slice(0, MATERIALS_SNIPPET_MAX - 2500);
        if (digests.length > MATERIALS_SNIPPET_MAX - 2500) {
          snip += "\n……（链接摘要过长已截断）";
        }
      } else {
        snip = materials.slice(0, MATERIALS_SNIPPET_MAX) + "\n……（已有材料过长，已截断）";
      }
    }
    parts.push(`已有参考材料（请在此基础上补充、核实、扩展，避免简单重复）：\n${snip}`);
  }
  return parts.join("\n\n");
}

/** Fast Google Search grounding: concise bullet digest for script writing. */
function googleSearchPrompt(context) {
  return (
    `你在为播客写稿前搜集联网资料。请围绕下面信息搜索并整理创作素材。\n\n` +
    `${context}\n\n` +
    `请用中文、以要点列出：\n` +
    `1. 关键事实与数据（尽量带出处意识）\n` +
    `2. 时间线或背景\n` +
    `3. 不同立场/争议点\n` +
    `4. 适合在节目里展开的讨论角度\n` +
    `具体、可引用，避免空泛。若有「调研需求」，优先满足其中的方向。`
  );
}

/** Deep Research: framed as a full research-report task. */
function deepResearchPrompt(context) {
  return (
    `请围绕以下播客选题做一次联网深度调研，产出可供主创写逐字稿使用的中文研究报告。\n\n` +
    `${context}\n\n` +
    `调研要求：\n` +
    `- 若有「调研需求」，以其为最高优先级；否则根据标题与主题自行规划检索\n` +
    `- 覆盖：背景与现状、关键事实与数据、主要争议与不同立场、近期动态（如有）、对普通人的影响\n` +
    `- 结构清晰（分节），结论可引用；列出重要来源或链接\n` +
    `- 若已有参考材料，请核实并补充缺口，不要整段复述\n` +
    `- 最后给出 3–6 个适合播客讨论的角度或问题`
  );
}

function promptForMode(searchMode, context) {
  if (searchMode === "google") return googleSearchPrompt(context);
  return deepResearchPrompt(context);
}

/**
 * Pull http(s) URLs from free-form materials text (max MAX_MATERIAL_URLS).
 * @param {string} text
 * @returns {string[]}
 */
export function extractUrlsFromText(text) {
  const raw = String(text || "");
  const re = /https?:\/\/[^\s)\]>"'<>]+/gi;
  const urls = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(raw)) !== null) {
    let url = m[0].replace(/[.,;:!?）】》」』]+$/u, "");
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      url = u.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_MATERIAL_URLS) break;
  }
  return urls;
}

/**
 * Collect unique URLs from materials text and the dedicated links field.
 * @param {string} materials
 * @param {string} [materialLinks]
 */
export function collectMaterialUrls(materials, materialLinks = "") {
  const fromMaterials = extractUrlsFromText(materials);
  const fromLinks = extractUrlsFromText(materialLinks);
  const seen = new Set();
  const urls = [];
  for (const url of [...fromLinks, ...fromMaterials]) {
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_MATERIAL_URLS) break;
  }
  return urls;
}

/**
 * Fetch URLs from materials + materialLinks via Gemini url_context, append digests.
 * @param {string|{ materials?: string, materialLinks?: string }} input
 * @returns {Promise<{ materials: string, fetched: Array<{title:string,url:string}>, failed: string[] }>}
 */
export async function expandMaterialsLinks(input) {
  const original = typeof input === "string" ? String(input || "") : String(input?.materials || "");
  const materialLinks = typeof input === "string" ? "" : String(input?.materialLinks || "");
  const urls = collectMaterialUrls(original, materialLinks);
  if (urls.length === 0) {
    return { materials: original, fetched: [], failed: [] };
  }

  const apiKey = requireApiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const list = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
  const prompt =
    `请使用 URL 上下文工具打开下面每一个链接，读取页面（含帖子正文与主要评论/讨论，若有）。\n` +
    `对每个链接输出一节，严格按此格式（用中文）：\n\n` +
    `### 链接 N\n` +
    `URL: <原样 URL>\n` +
    `状态: 成功 或 失败\n` +
    `标题: <页面标题，失败可写未知>\n` +
    `内容摘要:\n` +
    `<成功时：保留关键论点、事实、有代表性的原话；失败时：简短说明原因>\n\n` +
    `不要编造打不开的页面内容。链接列表：\n${list}`;

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ url_context: {} }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`参考材料链接抓取失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();

  const metaList =
    cand?.urlContextMetadata?.urlMetadata ||
    cand?.url_context_metadata?.url_metadata ||
    [];
  const fetched = [];
  const failed = [];
  const seenFetch = new Set();

  for (const meta of metaList) {
    const url = meta.retrievedUrl || meta.retrieved_url || "";
    const status = String(meta.urlRetrievalStatus || meta.url_retrieval_status || "");
    if (!url) continue;
    if (/SUCCESS/i.test(status)) {
      if (!seenFetch.has(url)) {
        seenFetch.add(url);
        fetched.push({ title: url, url });
      }
    } else if (!failed.includes(url)) {
      failed.push(url);
    }
  }
  for (const url of urls) {
    if (!seenFetch.has(url) && !failed.includes(url) && text) {
      // Metadata incomplete but model returned text — treat as fetched for UI.
      fetched.push({ title: url, url });
      seenFetch.add(url);
    } else if (!seenFetch.has(url) && !failed.includes(url) && !text) {
      failed.push(url);
    }
  }

  if (!text) {
    const note =
      `## 链接自动抓取\n（未能从以下链接提取正文，写稿时请仅把 URL 当线索，勿假装已读：）\n` +
      urls.map((u) => `- ${u}`).join("\n");
    return {
      materials: original ? `${original}\n\n${note}` : note,
      fetched: [],
      failed: urls,
    };
  }

  const block = `## 链接自动抓取（写稿须优先依据下列正文，而非仅 URL）\n${text}`;
  return {
    materials: original ? `${original}\n\n${block}` : block,
    fetched,
    failed,
  };
}

/**
 * Extract markdown links and bare URLs from research text.
 * @param {string} text
 * @returns {Array<{title:string,url:string}>}
 */
function extractSourcesFromText(text) {
  const sources = [];
  const seen = new Set();
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = mdLink.exec(text)) !== null) {
    const url = m[2];
    if (!seen.has(url)) {
      seen.add(url);
      sources.push({ title: m[1] || url, url });
    }
  }
  const bare = /https?:\/\/[^\s)\]>"']+/g;
  while ((m = bare.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      sources.push({ title: url, url });
    }
  }
  return sources;
}

/**
 * Pull output text from an Interactions API result.
 * Prefers output_text; falls back to the last step's text content.
 */
function interactionOutputText(result) {
  if (result?.output_text && String(result.output_text).trim()) {
    return String(result.output_text).trim();
  }
  const steps = result?.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    const last = steps[steps.length - 1];
    const parts = last?.content;
    if (Array.isArray(parts)) {
      const text = parts
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

/**
 * @param {string} prompt
 * @returns {Promise<{ text: string, sources: Array<{title:string,url:string}> }>}
 */
export async function searchMaterial(prompt) {
  const apiKey = requireApiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini 搜索失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();

  // Grounding sources (the actual web pages Gemini consulted).
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const sources = [];
  const seen = new Set();
  for (const ch of chunks) {
    const url = ch?.web?.uri;
    if (url && !seen.has(url)) {
      seen.add(url);
      sources.push({ title: ch.web.title || url, url });
    }
  }

  if (!text) throw new Error("Gemini 未返回可用的搜索结果");
  return { text, sources };
}

/**
 * @param {string} prompt
 * @param {"deep_research"|"deep_research_max"} mode
 * @param {(() => void)=} onTick
 */
export async function deepResearchMaterial(prompt, mode, onTick) {
  const apiKey = requireApiKey();
  const agent = DEEP_AGENTS[mode];
  if (!agent) throw new Error(`未知的 Deep Research 模式: ${mode}`);

  const aiOpts = { apiKey };
  const baseUrl = process.env.GEMINI_BASE_URL;
  if (baseUrl) {
    aiOpts.httpOptions = { baseUrl: baseUrl.replace(/\/$/, "") };
  }
  const ai = new GoogleGenAI(aiOpts);

  const tools = [{ type: "google_search" }, { type: "url_context" }];

  const interaction = await ai.interactions.create({
    agent,
    input: prompt,
    background: true,
    tools,
    agent_config: {
      type: "deep-research",
      thinking_summaries: "auto",
      visualization: "auto",
    },
  });

  const id = interaction.id;
  if (!id) throw new Error("Deep Research 未返回 interaction id");

  while (true) {
    if (typeof onTick === "function") onTick();
    const result = await ai.interactions.get(id);
    if (result.status === "completed") {
      const text = interactionOutputText(result);
      if (!text) throw new Error("Deep Research 未返回可用报告");
      const sources = extractSourcesFromText(text);
      return { text, sources };
    }
    if (result.status === "failed") {
      const detail = result.error ? String(result.error) : "";
      throw new Error(`Deep Research 失败${detail ? `: ${detail}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

/**
 * Unified entry: build context + mode-specific prompt, then dispatch.
 * @param {{ title?: string, topic?: string, searchBrief?: string, materials?: string }} ctx
 * @param {"google"|"deep_research"|"deep_research_max"} searchMode
 * @param {(() => void)=} onTick
 */
export async function gatherSearchMaterial(ctx, searchMode, onTick) {
  const context = typeof ctx === "string" ? ctx : buildSearchContext(ctx);
  if (!context.trim()) {
    throw new Error("请至少填写标题、主题或调研需求，再开启联网搜索");
  }
  const prompt = promptForMode(searchMode, context);

  if (searchMode === "google") {
    const found = await searchMaterial(prompt);
    return { ...found, heading: SEARCH_HEADINGS.google };
  }
  if (searchMode === "deep_research" || searchMode === "deep_research_max") {
    const found = await deepResearchMaterial(prompt, searchMode, onTick);
    return { ...found, heading: SEARCH_HEADINGS[searchMode] };
  }
  throw new Error(`不支持的搜索模式: ${searchMode}`);
}

const EDUCATION_LABELS = {
  low: "低",
  mid: "中",
  high: "高",
  elite: "极高",
  expert: "专家",
};

const PERSONALITY_HINTS = {
  gentle: "极度温柔、柔和、体贴",
  soft: "偏温柔、好说话",
  balanced: "性格中性、有棱有角但不极端",
  spicy: "偏泼辣、直来直去、爱呛人",
  fierce: "极度泼辣、嘴硬、火力全开",
};

const PERSONALITY_LABELS = {
  gentle: "温柔",
  soft: "偏温柔",
  balanced: "中性",
  spicy: "偏泼辣",
  fierce: "泼辣",
};

const OPENNESS_HINTS = {
  conservative: "极度保守、传统、谨慎",
  cautious: "偏保守、务实、警惕新潮",
  neutral: "立场中性、视情况而定",
  open: "偏开放、好奇、敢尝鲜",
  radical: "极度开放、前卫、反传统",
};

const OPENNESS_LABELS = {
  conservative: "保守",
  cautious: "偏保守",
  neutral: "中性",
  open: "偏开放",
  radical: "开放",
};

/**
 * Random vivid podcast character from a few dials. Uses GEMINI_MODEL (default gemini-3.5-flash).
 * @param {{ education: string, personality: string, openness: string, expertField?: string }} opts
 * @returns {Promise<{ name: string, persona: string, languageStyle: string, faction: string, backstory: string, defaultEmotion: string, speed: number }>}
 */
export async function generateRandomCharacter(opts = {}) {
  const education = EDUCATION_LABELS[opts.education] ? opts.education : "mid";
  const personality = PERSONALITY_HINTS[opts.personality] ? opts.personality : "balanced";
  const openness = OPENNESS_HINTS[opts.openness] ? opts.openness : "neutral";
  const expertField = String(opts.expertField || "").trim();

  if (education === "expert" && !expertField) {
    throw new Error("选择「专家」时必须填写具体领域");
  }

  const eduLabel =
    education === "expert"
      ? `专家（领域：${expertField}）`
      : EDUCATION_LABELS[education];
  const eduHint =
    education === "expert"
      ? `该角色是「${expertField}」领域的专家：知识深度、术语习惯、举例方式都要贴合该领域，但不要堆砌不可懂的黑话`
      : "体现为知识面、用词习惯、论证方式，不要写成学历证书";

  const temperHint = PERSONALITY_HINTS[personality];
  const campHint = OPENNESS_HINTS[openness];

  const prompt =
    `你是播客角色设定助手。请根据下列约束，随机创造一个「性格鲜明、适合播客对谈」的中文角色。\n\n` +
    `约束：\n` +
    `- 受教育程度：${eduLabel}（${eduHint}）\n` +
    `- 性格（温柔 → 泼辣）：${PERSONALITY_LABELS[personality]}，整体气质应接近「${temperHint}」\n` +
    `- 阵营（保守 → 开放）：${OPENNESS_LABELS[openness]}，观点立场应接近「${campHint}」\n\n` +
    `要求：\n` +
    `- 角色要具体、有记忆点，避免模板脸与空话\n` +
    `- 名字像真人常用名或有辨识度的网名，不要「小明」「AI助手」这类\n` +
    `- persona / languageStyle / faction 各写 1～2 句，信息密度高\n` +
    `- backstory（过往经历）写 2～4 句，具体可感，能解释其性格与立场从何而来` +
    (education === "expert" ? `；经历须与「${expertField}」相关\n` : `\n`) +
    `- defaultEmotion 用短词（如：热情、冷峻、戏谑）\n` +
    `- speed 取 0.85～1.2 之间、符合性格的语速倍率（数字）\n` +
    `- 不要生成头像、不要生成音色 ID\n\n` +
    `只输出一个 JSON 对象，不要 markdown 围栏，不要其它说明。字段：\n` +
    `{"name":"...","persona":"...","languageStyle":"...","faction":"...","backstory":"...","defaultEmotion":"...","speed":1}`;

  const apiKey = requireApiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`随机角色生成失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("模型返回的角色 JSON 无法解析");
  }

  const speed = Number(parsed.speed);
  return {
    name: String(parsed.name || "").trim() || "未命名角色",
    persona: String(parsed.persona || "").trim(),
    languageStyle: String(parsed.languageStyle || "").trim(),
    faction: String(parsed.faction || "").trim(),
    backstory: String(parsed.backstory || "").trim(),
    defaultEmotion: String(parsed.defaultEmotion || "").trim(),
    speed: Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? Math.round(speed * 100) / 100 : 1,
  };
}

const EPISODE_POLISH_FIELDS = {
  topic: {
    label: "主题",
    emptyError: "请先填写主题，再进行 AI 润色",
    role: "节目主题润色助手",
    rules:
      `- 只润色「主题」本身，不要输出标题或其它字段\n` +
      `- 保留用户原意与关键对象，不要换成另一个话题\n` +
      `- 写得更具体、清晰：最好能看出「聊什么 / 发生什么 + 什么角度或切口」\n` +
      `- 1～3 句即可，口语自然，不要空泛口号，不要堆砌形容词\n` +
      `- 不要加「本期我们将讨论」这类套话前缀`,
  },
  storyBackground: {
    label: "故事背景",
    emptyError: "请先填写故事背景，再进行 AI 润色",
    role: "情景剧故事背景润色助手",
    rules:
      `- 只润色「故事背景」，不要改写人物关系、情节或主题\n` +
      `- 保留用户原意的时代、地点、世界观与外部情境\n` +
      `- 写得更具体可感，便于演员进入情境；2～6 句为宜\n` +
      `- 不要编造与原文冲突的新世界观`,
  },
  characterRelations: {
    label: "人物关系",
    emptyError: "请先填写人物关系，再进行 AI 润色",
    role: "情景剧人物关系润色助手",
    rules:
      `- 只润色「人物关系」，不要改写故事背景、情节或主题\n` +
      `- 保留用户设定的关系、矛盾与羁绊，写得更清晰有张力\n` +
      `- 点明谁与谁、什么关系、潜在冲突；2～6 句为宜\n` +
      `- 不要无故新增原设定没有的主要人物`,
  },
  plotDevelopment: {
    label: "情节发展",
    emptyError: "请先填写情节发展，再进行 AI 润色",
    role: "情景剧情节发展润色助手",
    rules:
      `- 只润色「情节发展」，不要改写故事背景、人物关系或主题\n` +
      `- 保留用户原意的起因 → 冲突 → 转折 → 收束\n` +
      `- 写得更具体、可拍可演，节奏清楚；不要写成完整对白稿\n` +
      `- 不要把故事改成另一个剧本`,
  },
};

/**
 * Polish one episode text field the user already wrote.
 * Optional sibling fields / materials are context only.
 * @param {{
 *   field?: string,
 *   topic?: string,
 *   storyBackground?: string,
 *   characterRelations?: string,
 *   plotDevelopment?: string,
 *   title?: string,
 *   materials?: string,
 *   mode?: string,
 * }} draft
 */
export async function polishEpisodeTopic(draft = {}) {
  const field = EPISODE_POLISH_FIELDS[draft.field] ? draft.field : "topic";
  const meta = EPISODE_POLISH_FIELDS[field];
  const text = String(draft[field] ?? draft.topic ?? "").trim();
  if (!text) throw new Error(meta.emptyError);

  const title = String(draft.title || "").trim();
  const materials = String(draft.materials || "").trim();
  const mode = draft.mode === "sitcom" ? "sitcom" : "podcast";

  const contextLines = [`- 当前${meta.label}：${text}`];
  if (title) contextLines.push(`- 节目标题（仅供参考，不要改写）：${title}`);
  if (mode === "sitcom") {
    const siblings = [
      ["storyBackground", "故事背景"],
      ["characterRelations", "人物关系"],
      ["plotDevelopment", "情节发展"],
      ["topic", "本集主题"],
    ];
    for (const [key, label] of siblings) {
      if (key === field) continue;
      const v = String(draft[key] || "").trim();
      if (!v) continue;
      const snip = v.length > 800 ? v.slice(0, 800) + "……" : v;
      contextLines.push(`- ${label}（仅供参考，不要改写）：${snip}`);
    }
  }
  if (materials) {
    const snip =
      materials.length > 1500 ? materials.slice(0, 1500) + "……（已截断）" : materials;
    contextLines.push(`- 参考材料摘要（仅供参考，不要改写材料）：\n${snip}`);
  }

  const prompt =
    `你是${meta.role}。用户已写下「${meta.label}」，请在保留核心意图的前提下润色。\n\n` +
    `${contextLines.join("\n")}\n\n` +
    `规则：\n` +
    `${meta.rules}\n` +
    `- text 字段内如需引号，一律用中文全角引号“”或「」，禁止英文半角双引号\n` +
    `- text 写成一段连续文字；若需换行用 \\n，不要直接插入未转义换行\n\n` +
    `只输出一个 JSON 对象：{"text":"润色后的内容"}`;

  const apiKey = requireApiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING" },
          },
          required: ["text"],
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI 润色失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const { text: raw, blockReason } = geminiResponseText(data);
  if (!raw) {
    throw new Error(
      blockReason
        ? `AI 润色被拦截（${blockReason}），请改写原文后再试`
        : "AI 润色没有返回内容，请稍后重试"
    );
  }

  const parsed = parseModelJson(raw);
  let polished = String(parsed?.text || parsed?.topic || parsed?.[field] || "").trim();
  if (!polished) {
    polished = extractJsonStringField(raw, ["text", "topic", field, meta.label]);
  }
  // Last resort: model ignored JSON and returned plain prose.
  if (!polished) {
    const plain = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    if (plain && !plain.startsWith("{") && plain.length >= 2) {
      polished = plain;
    }
  }
  if (!polished) {
    throw new Error(`AI 润色返回格式异常：${raw.slice(0, 160)}`);
  }
  // Keep legacy `topic` key for older clients; also return field + text.
  return { field, text: polished, topic: field === "topic" ? polished : String(draft.topic || "") };
}

/**
 * Turn a Google Search digest into clean「参考材料」bullets for the form field.
 * @param {string} searchText
 * @param {{ title?: string, topic?: string, searchBrief?: string }} ctx
 */
export async function summarizeSearchToMaterials(searchText, ctx = {}) {
  const text = String(searchText || "").trim();
  if (!text) throw new Error("没有可总结的搜索结果");

  const title = String(ctx.title || "").trim();
  const topic = String(ctx.topic || "").trim();
  const searchBrief = String(ctx.searchBrief || "").trim();
  const snip = text.length > 8000 ? text.slice(0, 8000) + "\n……（已截断）" : text;

  const prompt =
    `你是节目创作助理。下面是联网搜索得到的原始整理，请总结成可直接贴进「参考材料」字段的中文要点。\n\n` +
    (title ? `节目标题：${title}\n` : "") +
    (topic ? `主题：${topic}\n` : "") +
    (searchBrief ? `调研需求：${searchBrief}\n` : "") +
    `\n搜索结果：\n${snip}\n\n` +
    `要求：\n` +
    `- 保留关键事实、数据、争议与可用讨论角度\n` +
    `- 分条列出，简洁可引用，去掉套话与重复\n` +
    `- 不要编造搜索结果里没有的信息\n` +
    `- 用普通中文排版：可用「1. 2. 3.」或「- 」分条；不要用 Markdown（不要 ##、**、\`\`\`）\n` +
    `- 不要输出 JSON，直接输出参考材料正文`;

  const apiKey = requireApiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`搜索结果总结失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const summary = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();
  if (!summary) throw new Error("模型未返回有效的参考材料总结");
  return summary;
}

/**
 * Run standalone research for the episode form (before create / generate).
 * - google: summarize into materials
 * - deep_*: full report → materials; source URLs → materialLinks
 * @param {{
 *   title?: string, topic?: string, searchBrief?: string, materials?: string,
 *   materialLinks?: string, searchMode?: string,
 *   storyBackground?: string, characterRelations?: string, plotDevelopment?: string, mode?: string,
 * }} draft
 * @param {(() => void)=} onTick
 */
export async function runEpisodeFormResearch(draft = {}, onTick) {
  const searchMode = draft.searchMode || "google";
  if (searchMode === "off") {
    throw new Error("请先选择联网搜索模式，再开始调研");
  }

  const topicForSearch =
    String(draft.topic || "").trim() ||
    (draft.mode === "sitcom"
      ? [draft.plotDevelopment, draft.storyBackground].filter(Boolean).join("\n").trim()
      : "");

  const found = await gatherSearchMaterial(
    {
      title: draft.title,
      topic: topicForSearch,
      searchBrief: draft.searchBrief,
      materials: draft.materials,
    },
    searchMode,
    onTick
  );

  const existingMaterials = String(draft.materials || "").trim();
  const existingLinks = String(draft.materialLinks || "").trim();
  const sources = Array.isArray(found.sources) ? found.sources : [];
  let materials = existingMaterials;
  let materialLinks = existingLinks;

  if (searchMode === "google") {
    const summary = await summarizeSearchToMaterials(found.text, {
      title: draft.title,
      topic: topicForSearch,
      searchBrief: draft.searchBrief,
    });
    const block = `【联网搜索资料】\n${summary}`;
    if (!existingMaterials) {
      materials = block;
    } else if (/【联网搜索资料】/.test(existingMaterials) || /##\s*联网搜索资料/.test(existingMaterials)) {
      const cleaned = existingMaterials
        .replace(/##\s*联网搜索资料摘要[\s\S]*?(?=\n## |\n【|$)/, "")
        .replace(/【联网搜索资料】[\s\S]*?(?=\n【|$)/, "")
        .trim();
      materials = cleaned ? `${cleaned}\n\n${block}` : block;
    } else {
      materials = `${existingMaterials}\n\n${block}`;
    }
  } else {
    const heading = found.heading || SEARCH_HEADINGS[searchMode] || "Deep Research 调研报告";
    const plainHeading = heading.replace(/^#+\s*/, "");
    const block = `【${plainHeading}】\n${found.text}`;
    materials = existingMaterials
      ? existingMaterials.includes(`【${plainHeading}】`) || existingMaterials.includes(`## ${heading}`)
        ? existingMaterials
        : `${existingMaterials}\n\n${block}`
      : block;

    const linkLines = existingLinks
      ? existingLinks.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];
    const seen = new Set(linkLines);
    for (const s of sources) {
      const url = String(s?.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      linkLines.push(url);
    }
    // Also pull any URLs embedded in the report text.
    for (const url of extractUrlsFromText(found.text)) {
      if (seen.has(url)) continue;
      seen.add(url);
      linkLines.push(url);
    }
    materialLinks = linkLines.join("\n");
  }

  return {
    materials,
    materialLinks,
    searchSources: sources,
    searchDone: true,
    heading: found.heading || null,
  };
}

export async function polishCharacter(draft = {}) {
  const filled = {
    name: String(draft.name || "").trim(),
    persona: String(draft.persona || "").trim(),
    languageStyle: String(draft.languageStyle || "").trim(),
    faction: String(draft.faction || "").trim(),
    backstory: String(draft.backstory || "").trim(),
    defaultEmotion: String(draft.defaultEmotion || "").trim(),
    speed: Number(draft.speed),
  };

  const hasAny =
    filled.name ||
    filled.persona ||
    filled.languageStyle ||
    filled.faction ||
    filled.backstory ||
    filled.defaultEmotion;
  if (!hasAny) {
    throw new Error("请先至少填写一点角色信息，再进行 AI 润色");
  }

  const lines = [];
  if (filled.name) lines.push(`- name: ${filled.name}`);
  else lines.push(`- name: （空，请补全）`);
  if (filled.persona) lines.push(`- persona: ${filled.persona}`);
  else lines.push(`- persona: （空，请补全）`);
  if (filled.languageStyle) lines.push(`- languageStyle: ${filled.languageStyle}`);
  else lines.push(`- languageStyle: （空，请补全）`);
  if (filled.faction) lines.push(`- faction: ${filled.faction}`);
  else lines.push(`- faction: （空，请补全）`);
  if (filled.backstory) lines.push(`- backstory: ${filled.backstory}`);
  else lines.push(`- backstory: （空，请补全）`);
  if (filled.defaultEmotion) lines.push(`- defaultEmotion: ${filled.defaultEmotion}`);
  else lines.push(`- defaultEmotion: （空，请补全）`);
  if (Number.isFinite(filled.speed) && filled.speed > 0) {
    lines.push(`- speed: ${filled.speed}（可微调到更贴合性格）`);
  } else {
    lines.push(`- speed: （空，请给 0.85～1.2 的语速倍率）`);
  }

  const prompt =
    `你是播客角色设定润色助手。用户已写下一些字段（可能残缺、口语化或不自洽），请在保留其核心意图的前提下润色并补全。\n\n` +
    `当前草稿：\n${lines.join("\n")}\n\n` +
    `规则：\n` +
    `- 已填写的内容：润色得更自洽、具体、有播客对谈可用的信息密度；不要推翻用户原意，可小幅升华与衔接\n` +
    `- 空字段：根据已有信息合理补全，使角色完整鲜明\n` +
    `- persona / languageStyle / faction 各 1～2 句；backstory 2～4 句；defaultEmotion 用短词\n` +
    `- speed 取 0.85～1.2 之间数字\n` +
    `- 不要生成头像、不要生成音色 ID，也不要输出这些字段\n` +
    `- 名字若已有则尽量保留（可轻微润色）；若为空则起一个合适名字\n\n` +
    `只输出一个 JSON 对象，不要 markdown 围栏，不要其它说明。字段：\n` +
    `{"name":"...","persona":"...","languageStyle":"...","faction":"...","backstory":"...","defaultEmotion":"...","speed":1}`;

  const apiKey = requireApiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI 润色失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("模型返回的润色结果无法解析");
  }

  const speed = Number(parsed.speed);
  return {
    name: String(parsed.name || "").trim() || filled.name || "未命名角色",
    persona: String(parsed.persona || "").trim(),
    languageStyle: String(parsed.languageStyle || "").trim(),
    faction: String(parsed.faction || "").trim(),
    backstory: String(parsed.backstory || "").trim(),
    defaultEmotion: String(parsed.defaultEmotion || "").trim(),
    speed: Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? Math.round(speed * 100) / 100 : filled.speed || 1,
  };
}

export { SEARCH_HEADINGS };

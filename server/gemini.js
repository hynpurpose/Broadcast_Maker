// Gemini client for Google Search grounding and Deep Research — gathers
// reference material for a title/topic before Claude writes the script.
//
// - google: Generative Language API generateContent + google_search tool
// - deep_research / deep_research_max: Interactions API Deep Research agents
//
// GEMINI_BASE_URL lets you point at a proxy; default is Google official.
// The key is sent via the x-goog-api-key header (never in the URL).

import { GoogleGenAI } from "@google/genai";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com";
const MATERIALS_SNIPPET_MAX = 3000;

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
    const snip =
      materials.length > MATERIALS_SNIPPET_MAX
        ? materials.slice(0, MATERIALS_SNIPPET_MAX) + "\n……（已有材料过长，已截断）"
        : materials;
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

  const res = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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

export { SEARCH_HEADINGS };

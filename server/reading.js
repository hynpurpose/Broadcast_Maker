// Article intensive-reading: extract full text from URL, split into sense groups,
// then generate a reader/explainer script.

import { callClaudeJson } from "./claude.js";
import { proxyFetch } from "./http.js";

const LANG_LABELS = {
  zh: "中文",
  en: "英语",
  de: "德语",
  ja: "日语",
  fr: "法语",
  es: "西班牙语",
  ko: "韩语",
  it: "意大利语",
  pt: "葡萄牙语",
  ru: "俄语",
};

function langLabel(code) {
  return LANG_LABELS[code] || code || "未知语言";
}

function requireGeminiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env");
  if (!/^[\x20-\x7E]+$/.test(apiKey)) {
    throw new Error("GEMINI_API_KEY 看起来还是占位符，请在 .env 填入真实的 Google AI Studio key");
  }
  return apiKey;
}

/**
 * Fetch a URL via Gemini url_context and extract the full article body.
 * @param {string} url
 * @returns {Promise<{ title: string, articleText: string }>}
 */
export async function extractArticleFromUrl(url) {
  const trimmed = String(url || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("请提供有效的 http(s) 链接");
  }

  const apiKey = requireGeminiKey();
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(
    /\/$/,
    ""
  );
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt =
    `请使用 URL 上下文工具打开下面这个链接，提取页面中的**文章正文全文**。\n` +
    `要求：\n` +
    `1. 保留原文语言，不要翻译。\n` +
    `2. 尽量完整保留正文段落，按原文顺序输出。\n` +
    `3. 去掉导航、广告、页脚、推荐阅读、cookie 提示等无关内容。\n` +
    `4. 不要编造打不开或读不到的内容。\n` +
    `5. 只输出一个 JSON 对象（不要 markdown 代码块），格式：\n` +
    `{"title":"文章标题","articleText":"完整正文，段落之间用空行分隔"}\n\n` +
    `链接：${trimmed}`;

  const res = await proxyFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ url_context: {} }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`文章提取失败 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("未能从链接提取到正文，请检查链接是否可访问，或直接粘贴文章");
  }

  let json = null;
  try {
    json = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        json = JSON.parse(text.slice(start, end + 1));
      } catch {
        json = null;
      }
    }
  }

  const articleText = String(json?.articleText || "").trim();
  if (!articleText || articleText.length < 40) {
    throw new Error("提取到的正文过短或为空，请换链接或直接粘贴文章");
  }

  return {
    title: String(json?.title || "").trim() || "未命名文章",
    articleText,
  };
}

function characterBrief(c) {
  if (!c) return "";
  return [
    `id: ${c.id}`,
    `名字: ${c.name}`,
    c.persona ? `性格: ${c.persona}` : "",
    c.languageStyle ? `语言特色: ${c.languageStyle}` : "",
    c.faction ? `立场: ${c.faction}` : "",
    c.defaultEmotion ? `默认情绪: ${c.defaultEmotion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Split article into sentences (EN/CJK punctuation aware). */
function tokenizeSentences(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?<=[.!?…。！？；;])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts;
  return [raw];
}

/** Local sense-group split: prefer 1–3 sentences, keep groups fine-grained.
 * Soft-cap only at a high limit so long essays stay readable in detail. */
function splitBySenseGroupsLocal(text) {
  const sentences = tokenizeSentences(text);
  if (sentences.length === 0) return [];

  // ~1–3 sentences / group. Soft max keeps generation feasible without
  // collapsing a 1.5万字 essay into ~20 oversized chunks.
  const SOFT_MAX_GROUPS = 90;
  const TARGET_MIN = 70;
  const TARGET_MAX = 220;
  const MAX_SENTS = 3;

  const groups = [];
  let buf = [];
  let bufLen = 0;

  function flush() {
    if (buf.length === 0) return;
    groups.push(buf.join(" ").replace(/\s+/g, " ").trim());
    buf = [];
    bufLen = 0;
  }

  for (const s of sentences) {
    const len = s.length;
    if (buf.length === 0 && len >= TARGET_MAX) {
      groups.push(s);
      continue;
    }
    if (buf.length > 0 && (bufLen + len > TARGET_MAX || buf.length >= MAX_SENTS)) {
      flush();
    }
    buf.push(s);
    bufLen += len;
    // Flush once we have a complete short sense group.
    if (bufLen >= TARGET_MIN || buf.length >= MAX_SENTS) {
      flush();
    }
  }
  flush();

  if (groups.length >= 2 && groups[groups.length - 1].length < 35) {
    const last = groups.pop();
    groups[groups.length - 1] = `${groups[groups.length - 1]} ${last}`.trim();
  }

  // Only merge if truly extreme (would make API batching impractical).
  while (groups.length > SOFT_MAX_GROUPS) {
    const merged = [];
    for (let i = 0; i < groups.length; i += 2) {
      if (i + 1 < groups.length) merged.push(`${groups[i]} ${groups[i + 1]}`.trim());
      else merged.push(groups[i]);
    }
    groups.length = 0;
    groups.push(...merged);
  }

  return groups.map((t, i) => ({ index: i, text: t }));
}

/**
 * Ask model only for sentence-index groups (tiny JSON). Falls back to local split
 * for long articles or parse failures — echoing full text in JSON often truncates.
 */
async function splitArticleParagraphs(reading, model) {
  const text = String(reading.articleText || "").trim();
  const local = splitBySenseGroupsLocal(text);
  if (local.length === 0) {
    throw new Error("意群拆分失败：文章正文为空");
  }

  const sentences = tokenizeSentences(text);
  // Long articles: skip LLM split (output would truncate). Local is enough.
  if (text.length > 6000 || sentences.length > 80) {
    console.log(
      `[reading] local split (text=${text.length} chars, sentences=${sentences.length}) → ${local.length} groups`
    );
    return local;
  }

  const articleLang = langLabel(reading.articleLanguage);
  const numbered = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const system =
    `你是语言学习材料编辑。任务：把已编号的句子按「意群」分组，供朗读。\n` +
    `规则：\n` +
    `- 每组约 1–3 个连续句子，语义相对完整。\n` +
    `- 不要太碎也不要太长；不要改写原文。\n` +
    `- 只返回句子下标分组，不要返回原文。\n` +
    `- JSON：{"groups":[[0,1],[2],[3,4,5],...]}\n` +
    `- 必须覆盖全部句子下标 0..N-1，且连续不重复。`;

  const user =
    `文章语言：${articleLang}\n标题：${reading.title || "（无）"}\n句子数：${sentences.length}\n\n${numbered}`;

  try {
    const { json, stopReason } = await callClaudeJson({
      model,
      system,
      user,
      maxTokens: 4096,
    });
    const groups = Array.isArray(json?.groups) ? json.groups : null;
    if (!groups || groups.length === 0) {
      console.warn(`[reading] AI split empty (stop=${stopReason}), fallback local`);
      return local;
    }

    const used = new Set();
    const paragraphs = [];
    for (const g of groups) {
      if (!Array.isArray(g) || g.length === 0) continue;
      const idxs = g.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < sentences.length);
      if (idxs.length === 0) continue;
      if (idxs.some((n) => used.has(n))) continue;
      idxs.forEach((n) => used.add(n));
      const chunk = idxs.map((n) => sentences[n]).join(" ").replace(/\s+/g, " ").trim();
      if (chunk) paragraphs.push({ index: paragraphs.length, text: chunk });
    }

    if (paragraphs.length === 0 || used.size < sentences.length * 0.85) {
      console.warn(
        `[reading] AI split coverage ${used.size}/${sentences.length}, fallback local`
      );
      return local;
    }

    const missing = [];
    for (let i = 0; i < sentences.length; i++) {
      if (!used.has(i)) missing.push(sentences[i]);
    }
    if (missing.length) {
      paragraphs.push({
        index: paragraphs.length,
        text: missing.join(" ").replace(/\s+/g, " ").trim(),
      });
    }

    return paragraphs;
  } catch (err) {
    console.warn(`[reading] AI split failed, fallback local:`, err?.message || err);
    return local;
  }
}

async function generateScriptFromParagraphs(reading, characters, paragraphs, onProgress) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const reader = byId.get(reading.readerId);
  const explainer = byId.get(reading.explainerId);
  if (!reader || !explainer) {
    throw new Error("朗读者或讲解者角色不存在");
  }

  const articleLang = langLabel(reading.articleLanguage);
  const explainLang = langLabel(reading.explainerLanguage);
  const model = reading.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

  const system =
    `你是语言精读播客编剧。为一篇${articleLang}文章写**完整逐字稿**，由朗读者与讲解者交替完成。\n\n` +
    `## 角色\n` +
    `- 朗读者（id=${reader.id}，名字=${reader.name}）：只用${articleLang}。台词几乎全是对应段落的**原文朗读**，最多加极少量语气词/停顿标签。禁止用其他语言翻译或讲解。\n` +
    `- 讲解者（id=${explainer.id}，名字=${explainer.name}）：只用${explainLang}讲解。先说这段大意，再解释重点词汇/短语，再附和段落信息说几句。可引用原文中的词组，但不要大段朗读原文。\n\n` +
    `## 节奏（必须严格遵守）\n` +
    `1. 开场：讲解者先用${explainLang}介绍本次精读（主题、文章语言、怎么学）。\n` +
    `2. 然后对每个意群段落：朗读者读该段原文 → 讲解者讲解该段。\n` +
    `3. 不要打乱顺序，不要合并段落，不要跳过段落。\n\n` +
    `## Fish Audio 标签\n` +
    `可在台词中嵌入 [pause] [long pause] [emphasis] [laughing] [chuckles] [sighs] 等方括号标签，适度使用。\n\n` +
    `## 输出\n` +
    `只输出 JSON（不要 markdown）：\n` +
    `{"title":"精读标题","segments":[{"speaker":"角色id","text":"完整台词","emotion":"可选"}]}\n` +
    `speaker 必须是 ${reader.id} 或 ${explainer.id}。`;

  const paraBlock = paragraphs
    .map((p) => `[段落 ${p.index + 1}]\n${p.text}`)
    .join("\n\n");

  const user =
    `精读标题建议：${reading.title || "文章精读"}\n` +
    `文章语言：${articleLang}\n讲解语言：${explainLang}\n` +
    `段落总数：${paragraphs.length}\n\n` +
    `## 朗读者\n${characterBrief(reader)}\n\n` +
    `## 讲解者\n${characterBrief(explainer)}\n\n` +
    `## 意群段落（按顺序处理）\n${paraBlock}`;

  onProgress?.({
    phase: "script",
    current: 0,
    total: paragraphs.length,
    message: `已拆成 ${paragraphs.length} 段，开始写精读稿…`,
    paragraphs,
  });

  // For long articles, generate in batches of paragraphs to avoid truncation.
  const BATCH = 4;
  if (paragraphs.length <= BATCH) {
    onProgress?.({
      phase: "script",
      current: 0,
      total: paragraphs.length,
      message: `写精读稿中（共 ${paragraphs.length} 段）…`,
    });
    const { json } = await callClaudeJson({
      model,
      system,
      user,
      maxTokens: 16384,
    });
    return normalizeScript(json, reading, byId);
  }

  const allSegments = [];
  let title = reading.title || "文章精读";

  for (let start = 0; start < paragraphs.length; start += BATCH) {
    const chunk = paragraphs.slice(start, start + BATCH);
    const isFirst = start === 0;
    const chunkBlock = chunk.map((p) => `[段落 ${p.index + 1}]\n${p.text}`).join("\n\n");
    const batchUser =
      `精读标题建议：${reading.title || "文章精读"}\n` +
      `文章语言：${articleLang}\n讲解语言：${explainLang}\n` +
      `本批是第 ${start + 1}–${start + chunk.length} 段（共 ${paragraphs.length} 段）。\n` +
      (isFirst
        ? `请先写讲解者开场，再写本批各段的「朗读→讲解」。\n`
        : `不要重复开场，只写本批各段的「朗读→讲解」，承接上文节奏。\n`) +
      `\n## 朗读者\n${characterBrief(reader)}\n\n## 讲解者\n${characterBrief(explainer)}\n\n` +
      `## 本批段落\n${chunkBlock}`;

    onProgress?.({
      phase: "script",
      current: start,
      total: paragraphs.length,
      message: `写精读稿…第 ${start + 1}–${start + chunk.length} / ${paragraphs.length} 段`,
    });

    const { json } = await callClaudeJson({
      model,
      system,
      user: batchUser,
      maxTokens: 12288,
    });

    if (json?.title && isFirst) title = String(json.title).trim() || title;
    const segs = Array.isArray(json?.segments) ? json.segments : [];
    for (const s of segs) {
      if (s && byId.has(s.speaker) && s.text) {
        allSegments.push({
          speaker: s.speaker,
          text: String(s.text).trim(),
          emotion: s.emotion ? String(s.emotion) : undefined,
        });
      }
    }

    onProgress?.({
      phase: "script",
      current: Math.min(start + chunk.length, paragraphs.length),
      total: paragraphs.length,
      message: `写精读稿…已完成 ${Math.min(start + chunk.length, paragraphs.length)} / ${paragraphs.length} 段`,
      partialScript: { title, segments: [...allSegments] },
    });
  }

  if (allSegments.length === 0) {
    throw new Error("精读稿生成失败：没有有效台词");
  }

  return { title, segments: allSegments };
}

function normalizeScript(json, reading, byId) {
  if (!json || !Array.isArray(json.segments)) {
    throw new Error("精读稿生成失败：模型未返回 segments");
  }
  const segments = json.segments
    .filter((s) => s && byId.has(s.speaker) && s.text)
    .map((s) => ({
      speaker: s.speaker,
      text: String(s.text).trim(),
      emotion: s.emotion ? String(s.emotion) : undefined,
    }));
  if (segments.length === 0) {
    throw new Error("精读稿生成失败：没有有效台词");
  }
  return {
    title: String(json.title || reading.title || "文章精读").trim(),
    segments,
  };
}

/**
 * Full pipeline: split → script.
 * @param {object} reading
 * @param {object[]} characters
 * @param {(p: object) => void} [onProgress]
 */
export async function generateReadingScript(reading, characters, onProgress) {
  const model = reading.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const text = String(reading.articleText || "").trim();
  if (text.length < 40) {
    throw new Error("文章正文太短，请粘贴完整文章或先提取链接");
  }
  if (!reading.readerId || !reading.explainerId) {
    throw new Error("请选择朗读者和讲解者");
  }
  if (reading.readerId === reading.explainerId) {
    throw new Error("朗读者和讲解者不能是同一人");
  }

  onProgress?.({ phase: "split", message: "正在按意群拆段…" });
  const paragraphs = await splitArticleParagraphs(reading, model);
  const script = await generateScriptFromParagraphs(reading, characters, paragraphs, onProgress);
  return { paragraphs, script };
}

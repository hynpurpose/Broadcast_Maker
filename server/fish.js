// Thin wrapper around the Fish Audio TTS HTTP API.
// Docs: https://fish.audio/zh-CN/blog/s2-1-pro-free-api/
// Endpoint: POST {FISH_BASE_URL}/v1/tts  (Bearer auth, `model` header selects engine)
//
// 国内直连 api.fish.audio 常会 CONNECT_TIMEOUT，可选：
//   FISH_PROXY=http://127.0.0.1:7897   （走本机 Clash 等代理，推荐）
//   FISH_BASE_URL=https://api.apiyi.com/fish  （API易中转；需账号开通 Fish 通道）

import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_BASE = "https://api.fish.audio";
const MAX_ATTEMPTS = 3;

let proxyAgent = null;

function fishBaseUrl() {
  return (process.env.FISH_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function fishApiKey() {
  const base = fishBaseUrl();
  // API易中转要用 API易令牌；官方 Fish key 会 401
  if (/apiyi\.com/i.test(base)) {
    return process.env.CLAUDE_API_KEY || process.env.FISH_API_KEY;
  }
  return process.env.FISH_API_KEY;
}

function getDispatcher() {
  const proxy =
    process.env.FISH_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  if (!proxy) return undefined;
  if (!proxyAgent) proxyAgent = new ProxyAgent(proxy);
  return proxyAgent;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Synthesize speech for a single utterance.
 * @param {object} opts
 * @param {string} opts.text        Text to speak. May contain Fish S2 [markup] tags.
 * @param {string} [opts.voiceId]   Fish Audio reference_id (voice model). Omit for default voice.
 * @param {number} [opts.speed]     Prosody speed multiplier (e.g. 1.0).
 * @param {string} [opts.format]    Output format: mp3 | wav | pcm. Default mp3.
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function synthesize({ text, voiceId, speed, format = "mp3" }) {
  const apiKey = fishApiKey();
  if (!apiKey) {
    throw new Error(
      /apiyi\.com/i.test(fishBaseUrl())
        ? "走 API易 中转时需要 CLAUDE_API_KEY（API易令牌）"
        : "FISH_API_KEY is not set in .env"
    );
  }

  // Fall back to the .env default voice when a character has no bound voice.
  const reference_id = voiceId || process.env.FISH_DEFAULT_VOICE_ID;
  const url = `${fishBaseUrl()}/v1/tts`;
  const dispatcher = getDispatcher();

  const body = {
    text,
    format,
    ...(reference_id ? { reference_id } : {}),
    ...(speed ? { prosody: { speed } } : {}),
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await undiciFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          model: process.env.FISH_MODEL || "s2.1-pro",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
        ...(dispatcher ? { dispatcher } : {}),
      }).catch((err) => {
        const cause = err?.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : "";
        const hint =
          /CONNECT_TIMEOUT|ENOTFOUND|ECONNREFUSED/i.test(String(err?.cause?.code || err?.message || ""))
            ? "。可在 .env 设置 FISH_PROXY=http://127.0.0.1:7897（本机代理端口）"
            : "";
        throw new Error(`无法连接 Fish Audio${cause}${hint}`);
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
          lastErr = new Error(`Fish Audio TTS failed (${res.status}): ${detail}`);
          await sleep(800 * attempt);
          continue;
        }
        throw new Error(`Fish Audio TTS failed (${res.status}): ${detail}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || `audio/${format}`;
      return { buffer: Buffer.from(arrayBuffer), contentType };
    } catch (err) {
      lastErr = err;
      const retryable = /CONNECT_TIMEOUT|ETIMEDOUT|ECONNRESET|503|429/i.test(String(err.message || err));
      if (retryable && attempt < MAX_ATTEMPTS) {
        await sleep(800 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Shared outbound HTTP helper. Domestic networks often cannot reach Google /
// Fish directly — reuse FISH_PROXY / HTTPS_PROXY / HTTP_PROXY via undici.

import { ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from "undici";

let proxyAgent = null;
let proxyInited = false;

function proxyUrl() {
  return process.env.FISH_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
}

export function getProxyDispatcher() {
  const proxy = proxyUrl();
  if (!proxy) return undefined;
  if (!proxyAgent) proxyAgent = new ProxyAgent(proxy);
  return proxyAgent;
}

/** Call once after .env is loaded so Gemini SDK / fetch use the same proxy as Fish. */
export function initHttpProxy() {
  if (proxyInited) return;
  proxyInited = true;
  const proxy = proxyUrl();
  if (!proxy) {
    console.log("[http] no FISH_PROXY / HTTPS_PROXY — outbound requests go direct");
    return;
  }
  const agent = getProxyDispatcher();
  if (agent) setGlobalDispatcher(agent);
  console.log(`[http] outbound proxy: ${proxy}`);
}

/**
 * fetch() that honors the local proxy env vars.
 * @param {string|URL} url
 * @param {RequestInit & { dispatcher?: unknown }} [init]
 */
export async function proxyFetch(url, init = {}) {
  const dispatcher = getProxyDispatcher();
  try {
    return await undiciFetch(url, {
      ...init,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || e?.cause || "";
    const proxy = proxyUrl();
    const hint = proxy
      ? `（已走代理 ${proxy}，请确认 Clash 等代理已开启）`
      : "（未配置代理：可在 .env 设置 FISH_PROXY=http://127.0.0.1:7897）";
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg}${cause ? ` [${cause}]` : ""}${hint}`);
  }
}

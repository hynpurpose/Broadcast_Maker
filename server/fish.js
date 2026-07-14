// Thin wrapper around the Fish Audio TTS HTTP API.
// Docs: https://fish.audio/zh-CN/blog/s2-1-pro-free-api/
// Endpoint: POST https://api.fish.audio/v1/tts  (Bearer auth, `model` header selects engine)

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";

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
  const apiKey = process.env.FISH_API_KEY;
  if (!apiKey) throw new Error("FISH_API_KEY is not set in .env");

  // Fall back to the .env default voice when a character has no bound voice.
  const reference_id = voiceId || process.env.FISH_DEFAULT_VOICE_ID;

  const body = {
    text,
    format,
    ...(reference_id ? { reference_id } : {}),
    ...(speed ? { prosody: { speed } } : {}),
  };

  const res = await fetch(FISH_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: process.env.FISH_MODEL || "s2.1-pro",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Fish Audio TTS failed (${res.status}): ${detail}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || `audio/${format}`;
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

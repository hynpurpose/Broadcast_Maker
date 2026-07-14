import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import cors from "cors";
import { listCharacters, saveCharacters, listEpisodes, saveEpisodes, listChats, saveChats, newId, AUDIO_DIR, DATA_DIR } from "./store.js";
import { generateChatReplies } from "./chat.js";
import { synthesize } from "./fish.js";
import { generateEpisodeScript } from "./claude.js";
import { gatherSearchMaterial } from "./gemini.js";

// In-memory generation progress, keyed by episode id (for the poll endpoint).
const genProgress = new Map();

// Load .env without a dependency (Node has no built-in dotenv loader in ESM).
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadEnv(join(__dirname, "..", ".env"));

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/api/uploads", express.static(join(DATA_DIR, "uploads")));

// --- Characters CRUD ---
app.get("/api/characters", async (_req, res) => {
  res.json(await listCharacters());
});

app.post("/api/characters", async (req, res) => {
  const characters = await listCharacters();
  const character = { id: newId(), ...sanitizeCharacter(req.body) };
  characters.push(character);
  await saveCharacters(characters);
  res.status(201).json(character);
});

app.put("/api/characters/:id", async (req, res) => {
  const characters = await listCharacters();
  const idx = characters.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  characters[idx] = { ...characters[idx], ...sanitizeCharacter(req.body), id: req.params.id };
  await saveCharacters(characters);
  res.json(characters[idx]);
});

app.delete("/api/characters/:id", async (req, res) => {
  const characters = await listCharacters();
  const next = characters.filter((c) => c.id !== req.params.id);
  await saveCharacters(next);
  res.status(204).end();
});

app.post("/api/upload", async (req, res) => {
  const { filename, base64 } = req.body || {};
  if (!filename || !base64) {
    return res.status(400).json({ error: "filename and base64 are required" });
  }
  try {
    const uploadsDir = join(DATA_DIR, "uploads");
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Clean filename to prevent path traversal
    const safeFilename = Date.now() + "_" + filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filepath = join(uploadsDir, safeFilename);

    // Decode base64
    const buffer = Buffer.from(base64, "base64");
    await writeFile(filepath, buffer);

    res.json({ url: `/api/uploads/${safeFilename}` });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Episodes CRUD ---
app.get("/api/episodes", async (_req, res) => {
  const episodes = await listEpisodes();
  res.json(
    episodes.map((e) => ({
      ...e,
      searchMode: resolveSearchMode(e),
    }))
  );
});

app.post("/api/episodes", async (req, res) => {
  const episodes = await listEpisodes();
  const now = new Date().toISOString();
  const episode = {
    id: newId("e"),
    ...sanitizeEpisode(req.body),
    status: "draft",
    script: null,
    createdAt: now,
    updatedAt: now,
  };
  episodes.push(episode);
  await saveEpisodes(episodes);
  res.status(201).json(episode);
});

app.put("/api/episodes/:id", async (req, res) => {
  const episodes = await listEpisodes();
  const idx = episodes.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  episodes[idx] = {
    ...episodes[idx],
    ...sanitizeEpisode(req.body),
    id: req.params.id,
    updatedAt: new Date().toISOString(),
  };
  await saveEpisodes(episodes);
  res.json(episodes[idx]);
});

app.delete("/api/episodes/:id", async (req, res) => {
  const episodes = await listEpisodes();
  await saveEpisodes(episodes.filter((e) => e.id !== req.params.id));
  res.status(204).end();
});

// Kick off script generation. Long episodes generate segment-by-segment and can
// take several minutes, so this returns immediately (202) and the work runs in
// the background. The client polls /gen-progress until phase is "done"/"error".
app.post("/api/episodes/:id/generate-script", async (req, res) => {
  const episodes = await listEpisodes();
  const idx = episodes.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const episode = episodes[idx];
  const searchMode = resolveSearchMode(episode);

  const allCharacters = await listCharacters();
  const participantIds = new Set([episode.hostId, ...(episode.guestIds || [])].filter(Boolean));
  const participants = allCharacters.filter((c) => participantIds.has(c.id));
  if (!episode.hostId) return res.status(400).json({ error: "请先指定主持人" });
  if (participants.length < 2) return res.status(400).json({ error: "至少需要主持人 + 1 位嘉宾" });

  const running = genProgress.get(episode.id);
  if (running && running.phase !== "done" && running.phase !== "error") {
    return res.status(409).json({ error: "该节目正在生成中" });
  }

  const wantsSearch = searchMode !== "off";
  genProgress.set(episode.id, { phase: wantsSearch ? "search" : "outline" });
  res.status(202).json({ started: true });

  // Background job — does not use `res` after the 202 above.
  (async () => {
    try {
      let materials = episode.materials || "";
      let searchSources = [];
      if (wantsSearch) {
        const found = await gatherSearchMaterial(
          {
            title: episode.title,
            topic: episode.topic,
            searchBrief: episode.searchBrief,
            materials: episode.materials,
          },
          searchMode,
          () => {
            genProgress.set(episode.id, { phase: "search" });
          }
        );
        searchSources = found.sources;
        materials =
          (materials ? materials + "\n\n" : "") + `## ${found.heading}\n${found.text}`;
      }

      const priorContext = buildPriorContext(episode, episodes);
      const script = await generateEpisodeScript(
        { ...episode, materials, priorContext },
        participants,
        (p) => genProgress.set(episode.id, p)
      );

      // Re-read to avoid clobbering concurrent edits, then persist.
      const latest = await listEpisodes();
      const li = latest.findIndex((e) => e.id === episode.id);
      if (li !== -1) {
        latest[li] = {
          ...latest[li],
          title: script.title || latest[li].title,
          script,
          searchSources,
          status: "script_ready",
          updatedAt: new Date().toISOString(),
        };
        await saveEpisodes(latest);
      }
      genProgress.set(episode.id, { phase: "done" });
    } catch (err) {
      genProgress.set(episode.id, { phase: "error", error: String(err.message || err) });
    }
  })();
});

// Poll generation progress. Returns {phase, current?, total?, error?} or null.
// Phases: search | outline | section | single | done | error.
app.get("/api/episodes/:id/gen-progress", (req, res) => {
  res.json(genProgress.get(req.params.id) || null);
});

// Edit a single segment's text / emotion (台词微调). Audio re-voices lazily since
// the TTS cache is keyed by text, so changed text yields a fresh clip on next play.
app.put("/api/episodes/:id/segments/:index", async (req, res) => {
  const episodes = await listEpisodes();
  const idx = episodes.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const episode = episodes[idx];
  const segIndex = Number(req.params.index);
  const segments = episode.script?.segments;
  if (!Array.isArray(segments) || !segments[segIndex]) {
    return res.status(404).json({ error: "segment not found" });
  }

  const seg = segments[segIndex];
  if (typeof req.body?.text === "string") seg.text = req.body.text;
  if (typeof req.body?.emotion === "string") seg.emotion = req.body.emotion;
  episode.updatedAt = new Date().toISOString();
  await saveEpisodes(episodes);
  res.json(episode);
});

// Export the whole episode as a single mp3 (naive frame concatenation — good
// enough for playback; no re-encoding, no extra deps). Synthesizes any missing
// segment on the fly, reusing the disk cache for everything already generated.
app.get("/api/episodes/:id/export", async (req, res) => {
  const episodes = await listEpisodes();
  const episode = episodes.find((e) => e.id === req.params.id);
  if (!episode) return res.status(404).json({ error: "not found" });
  const segments = episode.script?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: "该节目还没有脚本" });
  }

  const characters = await listCharacters();
  const byId = new Map(characters.map((c) => [c.id, c]));

  try {
    const buffers = [];
    for (const seg of segments) {
      const c = byId.get(seg.speaker);
      const { buffer } = await cachedSynthesize({
        text: seg.text,
        voiceId: c?.voiceId || undefined,
        speed: c?.speed,
        format: "mp3",
      });
      buffers.push(buffer);
    }
    const all = Buffer.concat(buffers);
    const name = (episode.title || "podcast").replace(/[\\/:*?"<>|]/g, "_");
    res.set("Content-Type", "audio/mpeg");
    res.set(
      "Content-Disposition",
      `attachment; filename="episode.mp3"; filename*=UTF-8''${encodeURIComponent(name)}.mp3`
    );
    res.send(all);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// --- Chats: real-time multi-character conversations ---
app.get("/api/chats", async (_req, res) => {
  res.json(await listChats());
});

app.post("/api/chats", async (req, res) => {
  const chats = await listChats();
  const participantIds = Array.isArray(req.body?.participantIds)
    ? req.body.participantIds.map(String)
    : [];
  if (participantIds.length === 0) return res.status(400).json({ error: "至少选择一个角色" });
  const characters = await listCharacters();
  const names = participantIds
    .map((id) => characters.find((c) => c.id === id)?.name)
    .filter(Boolean);
  const now = new Date().toISOString();
  const chat = {
    id: newId("t"),
    title: String(req.body?.title || "").trim() || `和 ${names.join("、")} 聊天`,
    participantIds,
    model: String(req.body?.model || "claude-sonnet-4-6"),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  chats.push(chat);
  await saveChats(chats);
  res.status(201).json(chat);
});

app.delete("/api/chats/:id", async (req, res) => {
  const chats = await listChats();
  await saveChats(chats.filter((c) => c.id !== req.params.id));
  res.status(204).end();
});

// Send a user message; Claude replies in character (1-3 replies).
app.post("/api/chats/:id/message", async (req, res) => {
  const isEndless = Boolean(req.body?.isEndless);
  const text = String(req.body?.text || "").trim();
  if (!text && !isEndless) return res.status(400).json({ error: "text is required when not in endless mode" });

  const chats = await listChats();
  const idx = chats.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const chat = chats[idx];

  const allCharacters = await listCharacters();
  const participants = allCharacters.filter((c) => chat.participantIds.includes(c.id));
  if (participants.length === 0) return res.status(400).json({ error: "该对话没有有效角色" });

  if (!isEndless) {
    const now = new Date().toISOString();
    chat.messages.push({ id: newId("m"), role: "user", text, ts: now });
  }

  try {
    const replies = await generateChatReplies(chat, participants, chat.messages, isEndless);
    const replyMessages = replies.map((r) => ({
      id: newId("m"),
      role: "character",
      characterId: r.characterId,
      text: r.text,
      emotion: r.emotion,
      ts: new Date().toISOString(),
    }));
    chat.messages.push(...replyMessages);
    chat.updatedAt = new Date().toISOString();
    await saveChats(chats);
    res.json({ chat, replies: replyMessages });
  } catch (err) {
    // Keep the user message persisted even if generation failed.
    chat.updatedAt = new Date().toISOString();
    await saveChats(chats);
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Synthesize one clip with a disk cache. Cache key = hash(model + voice + speed
// + format + text) so replays and the player's look-ahead prefetch are instant
// and never re-bill an identical clip. `nocache` forces a fresh take (重配).
async function cachedSynthesize({ text, voiceId, speed, format = "mp3", nocache = false }) {
  const model = process.env.FISH_MODEL || "s2.1-pro-free";
  const ref = voiceId || process.env.FISH_DEFAULT_VOICE_ID || "";
  const contentType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
  const key = createHash("sha1")
    .update([model, ref, speed || 1, format, text].join(" "))
    .digest("hex");
  const file = join(AUDIO_DIR, `${key}.${format}`);
  if (!nocache && existsSync(file)) {
    return { buffer: await readFile(file), contentType, hit: true };
  }
  const out = await synthesize({ text, voiceId, speed, format });
  await writeFile(file, out.buffer);
  return { buffer: out.buffer, contentType: out.contentType || contentType, hit: false };
}

// --- TTS: type/segment text -> get audio back (disk-cached) ---
app.post("/api/tts", async (req, res) => {
  const { text, voiceId, speed, format = "mp3", nocache = false } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });
  try {
    const r = await cachedSynthesize({ text, voiceId, speed, format, nocache });
    res.set("Content-Type", r.contentType);
    res.set("X-Cache", r.hit ? "HIT" : "MISS");
    return res.send(r.buffer);
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
});

function sanitizeCharacter(body = {}) {
  return {
    name: String(body.name || "").trim(),
    persona: String(body.persona || ""),
    languageStyle: String(body.languageStyle || ""),
    faction: String(body.faction || ""),
    voiceId: String(body.voiceId || "").trim(),
    speed: Number(body.speed) || 1,
    defaultEmotion: String(body.defaultEmotion || ""),
    avatar: String(body.avatar || ""),
  };
}

function resolveSearchMode(body = {}) {
  const VALID = new Set(["off", "google", "deep_research", "deep_research_max"]);
  if (VALID.has(body.searchMode)) return body.searchMode;
  return body.searchEnabled ? "google" : "off";
}

function sanitizeEpisode(body = {}) {
  return {
    title: String(body.title || "").trim(),
    topic: String(body.topic || ""),
    materials: String(body.materials || ""),
    durationMinutes: Math.max(1, Number(body.durationMinutes) || 10),
    hostId: String(body.hostId || ""),
    guestIds: Array.isArray(body.guestIds) ? body.guestIds.map(String) : [],
    model: String(body.model || "claude-sonnet-4-6"),
    searchMode: resolveSearchMode(body),
    searchBrief: String(body.searchBrief || ""),
    basedOnEpisodeIds: Array.isArray(body.basedOnEpisodeIds) ? body.basedOnEpisodeIds.map(String) : [],
  };
}

// Condense referenced episodes' scripts into a continuity-context string for Claude.
function buildPriorContext(episode, allEpisodes) {
  const ids = new Set(episode.basedOnEpisodeIds || []);
  if (ids.size === 0) return "";
  const MAX_CHARS = 15000; // keep the prompt bounded even with several prior episodes
  const blocks = [];
  let used = 0;
  for (const e of allEpisodes) {
    if (!ids.has(e.id) || e.id === episode.id || !e.script?.segments) continue;
    const lines = e.script.segments.map((s) => s.text).join("\n");
    const body = lines.length > 4000 ? lines.slice(0, 4000) + "……（略）" : lines;
    const block = `### 《${e.title || "未命名"}》\n${body}`;
    if (used + block.length > MAX_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join("\n\n");
}

async function loadEnv(path) {
  try {
    const raw = await readFile(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no .env yet — that's fine, keys just won't be set
  }
}

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`Broadcast Maker server on http://localhost:${PORT}`);
});

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import cors from "cors";
import { listCharacters, saveCharacters, listEpisodes, saveEpisodes, listChats, saveChats, newId, AUDIO_DIR, DATA_DIR } from "./store.js";
import { generateChatReplies, generateLearningPlan } from "./chat.js";
import { synthesize } from "./fish.js";
import { generateEpisodeScript } from "./claude.js";
import { gatherSearchMaterial, expandMaterialsLinks, collectMaterialUrls, generateRandomCharacter, polishCharacter, polishEpisodeTopic } from "./gemini.js";
import { loadCheckpoint, saveCheckpoint, clearCheckpoint } from "./checkpoint.js";

// In-memory generation progress, keyed by episode id (for the poll endpoint).
const genProgress = new Map();
/** Monotonic job epoch per episode — stale async jobs must not write after a force restart. */
const genJobEpoch = new Map();
/** If a job stops heartbeating for this long, treat as dead and allow a new start. */
const STALE_MS = 45 * 60 * 1000;

function isActivePhase(phase) {
  return phase && phase !== "done" && phase !== "error";
}

function touchProgress(id, patch) {
  const next = { ...patch, updatedAt: new Date().toISOString() };
  genProgress.set(id, next);
  return next;
}

function isProgressStale(p) {
  if (!p?.updatedAt) return true;
  const t = Date.parse(p.updatedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > STALE_MS;
}

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

/** Generate a draft character (not saved) from education / personality / openness dials. */
app.post("/api/characters/random", async (req, res) => {
  try {
    const draft = await generateRandomCharacter(req.body || {});
    res.json(draft);
  } catch (e) {
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Polish / complete a character draft (not saved). Leaves avatar & voiceId alone on the client. */
app.post("/api/characters/polish", async (req, res) => {
  try {
    const draft = await polishCharacter(req.body || {});
    res.json(draft);
  } catch (e) {
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Polish an episode topic the user already wrote (not saved). */
app.post("/api/episodes/polish-topic", async (req, res) => {
  try {
    const result = await polishEpisodeTopic(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
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
  const withCp = await Promise.all(
    episodes.map(async (e) => {
      const diskCp = await loadCheckpoint(e.id);
      return {
        ...e,
        mode: resolveEpisodeMode(e),
        searchMode: resolveSearchMode(e),
        storyBackground: e.storyBackground || "",
        characterRelations: e.characterRelations || "",
        narratorId: e.narratorId || "",
        leadActorIds: Array.isArray(e.leadActorIds) ? e.leadActorIds : [],
        plotDevelopment: e.plotDevelopment || "",
        genCheckpoint: diskCp || e.genCheckpoint || null,
      };
    })
  );
  res.json(withCp);
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
// Body: { force?: boolean } — force=true clears checkpoint and starts over.
app.post("/api/episodes/:id/generate-script", async (req, res) => {
  const episodes = await listEpisodes();
  const idx = episodes.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  let episode = episodes[idx];
  const searchMode = resolveSearchMode(episode);
  const force = Boolean(req.body?.force);

  const allCharacters = await listCharacters();
  const isSitcom = resolveEpisodeMode(episode) === "sitcom";
  const participantIds = new Set(
    isSitcom
      ? [episode.narratorId, ...(episode.leadActorIds || [])].filter(Boolean)
      : [episode.hostId, ...(episode.guestIds || [])].filter(Boolean)
  );
  const participants = allCharacters.filter((c) => participantIds.has(c.id));
  if (isSitcom) {
    if (!episode.narratorId) return res.status(400).json({ error: "请先指定旁白/主讲人" });
    if ((episode.leadActorIds || []).length < 1) {
      return res.status(400).json({ error: "至少需要旁白 + 1 位主演" });
    }
    if (participants.length < 2) {
      return res.status(400).json({ error: "旁白与主演必须是角色库中的有效角色" });
    }
  } else {
    if (!episode.hostId) return res.status(400).json({ error: "请先指定主持人" });
    if (participants.length < 2) return res.status(400).json({ error: "至少需要主持人 + 1 位嘉宾" });
  }

  const running = genProgress.get(episode.id);
  const busy = running && isActivePhase(running.phase);
  const stale = busy && isProgressStale(running);

  // Already running: tell client to re-attach polling (don't start a second job).
  // force=true or a stale/orphan heartbeat: take over with a new job epoch.
  if (busy && !force && !stale) {
    return res.status(409).json({
      error: "该节目正在生成中",
      busy: true,
      progress: running,
    });
  }

  const epoch = (genJobEpoch.get(episode.id) || 0) + 1;
  genJobEpoch.set(episode.id, epoch);
  const stillThisJob = () => genJobEpoch.get(episode.id) === epoch;

  if (force) {
    await clearCheckpoint(episode.id);
    episode = (await patchEpisodeFields(episode.id, { genCheckpoint: null })) || episode;
  }

  let cp = force ? null : (await loadCheckpoint(episode.id)) || episode.genCheckpoint || null;

  const wantsSearch = searchMode !== "off";
  const hasMaterialUrls =
    collectMaterialUrls(episode.materials || "", episode.materialLinks || "").length > 0;

  let initialPhase = "outline";
  if (cp?.outline && cp.nextSectionIndex < (cp.sectionCount || Infinity)) {
    initialPhase = "section";
  } else if (cp?.searchDone || (cp?.urlsFetched && !wantsSearch)) {
    initialPhase = "outline";
  } else if (!cp?.urlsFetched && hasMaterialUrls) {
    initialPhase = "fetch_urls";
  } else if (!cp?.searchDone && wantsSearch) {
    initialPhase = "search";
  }
  if (cp?.outline) {
    touchProgress(episode.id, {
      phase: "section",
      current: Math.min((cp.nextSectionIndex || 0) + 1, cp.sectionCount || 1),
      total: cp.sectionCount,
    });
  } else {
    touchProgress(episode.id, { phase: initialPhase, total: cp?.sectionCount });
  }

  res.status(202).json({
    started: true,
    resumed: Boolean(cp?.outline || cp?.searchDone || cp?.urlsFetched),
    tookOver: Boolean(busy && (force || stale)),
  });

  (async () => {
    try {
      let materials = cp?.materials ?? episode.materials ?? "";
      let searchSources = Array.isArray(cp?.searchSources)
        ? [...cp.searchSources]
        : Array.isArray(episode.searchSources)
        ? [...episode.searchSources]
        : [];
      let urlsFetched = Boolean(cp?.urlsFetched);
      let searchDone = Boolean(cp?.searchDone);

      const persistCp = async (extra = {}) => {
        if (!stillThisJob()) return;
        cp = await saveCheckpoint(episode.id, {
          materials,
          searchSources,
          urlsFetched,
          searchDone,
          outline: cp?.outline || null,
          segments: Array.isArray(cp?.segments) ? cp.segments : [],
          nextSectionIndex: cp?.nextSectionIndex || 0,
          sectionCount: cp?.sectionCount || 0,
          scriptTitle: cp?.scriptTitle || "",
          ...extra,
        });
        await patchEpisodeFields(episode.id, {
          genCheckpoint: {
            materials: cp.materials,
            searchSources: cp.searchSources,
            urlsFetched: cp.urlsFetched,
            searchDone: cp.searchDone,
            outline: cp.outline,
            segments: cp.segments,
            nextSectionIndex: cp.nextSectionIndex,
            sectionCount: cp.sectionCount,
            scriptTitle: cp.scriptTitle,
            updatedAt: cp.updatedAt,
          },
          searchSources: cp.searchSources,
          ...(cp.segments?.length
            ? {
                script: {
                  title: cp.scriptTitle || episode.title,
                  segments: cp.segments,
                },
                status: "draft",
              }
            : {}),
        });
      };

      const setProg = (p) => {
        if (!stillThisJob()) return;
        touchProgress(episode.id, p);
      };

      if (!urlsFetched && hasMaterialUrls) {
        setProg({ phase: "fetch_urls" });
        const expanded = await expandMaterialsLinks({
          materials: episode.materials || "",
          materialLinks: episode.materialLinks || "",
        });
        if (!stillThisJob()) return;
        if (!cp?.materials || !String(cp.materials).includes("## 链接自动抓取")) {
          materials = expanded.materials;
        }
        if (expanded.fetched.length) {
          const seen = new Set(searchSources.map((s) => s.url));
          for (const s of expanded.fetched) {
            if (s.url && !seen.has(s.url)) {
              seen.add(s.url);
              searchSources.push(s);
            }
          }
        }
        urlsFetched = true;
        await persistCp();
      } else if (!urlsFetched) {
        urlsFetched = true;
        await persistCp();
      }

      if (!searchDone && wantsSearch) {
        setProg({ phase: "search" });
        const found = await gatherSearchMaterial(
          {
            title: episode.title,
            topic: episode.topic,
            searchBrief: episode.searchBrief,
            materials,
          },
          searchMode,
          () => {
            setProg({ phase: "search" });
          }
        );
        if (!stillThisJob()) return;
        const seen = new Set(searchSources.map((s) => s.url));
        for (const s of found.sources || []) {
          if (s.url && !seen.has(s.url)) {
            seen.add(s.url);
            searchSources.push(s);
          }
        }
        if (!String(materials).includes(`## ${found.heading}`)) {
          materials =
            (materials ? materials + "\n\n" : "") + `## ${found.heading}\n${found.text}`;
        }
        searchDone = true;
        await persistCp();
      } else if (!searchDone) {
        searchDone = true;
        await persistCp();
      }

      if (!stillThisJob()) return;

      const latestList = await listEpisodes();
      const priorContext = buildPriorContext(episode, latestList);
      const resume =
        cp?.outline && Array.isArray(cp.outline.sections)
          ? {
              outline: cp.outline,
              segments: cp.segments || [],
              nextSectionIndex: cp.nextSectionIndex || 0,
            }
          : null;

      const script = await generateEpisodeScript(
        { ...episode, materials, priorContext },
        participants,
        (p) => setProg(p),
        {
          resume,
          onCheckpoint: async (partial) => {
            await persistCp({
              outline: partial.outline,
              segments: partial.segments,
              nextSectionIndex: partial.nextSectionIndex,
              sectionCount: partial.sectionCount,
              scriptTitle: partial.scriptTitle,
            });
          },
        }
      );

      if (!stillThisJob()) return;

      await clearCheckpoint(episode.id);
      await patchEpisodeFields(episode.id, {
        title: script.title || episode.title,
        script,
        searchSources,
        genCheckpoint: null,
        status: "script_ready",
      });
      setProg({ phase: "done" });
    } catch (err) {
      if (!stillThisJob()) return;
      touchProgress(episode.id, { phase: "error", error: String(err.message || err) });
    }
  })();
});
/** Merge fields onto an episode and save. Returns the updated episode or null. */
async function patchEpisodeFields(id, fields) {
  const episodes = await listEpisodes();
  const i = episodes.findIndex((e) => e.id === id);
  if (i === -1) return null;
  episodes[i] = {
    ...episodes[i],
    ...fields,
    id,
    updatedAt: new Date().toISOString(),
  };
  await saveEpisodes(episodes);
  return episodes[i];
}
// Poll generation progress. Returns {phase, current?, total?, error?} or null.
// Phases: fetch_urls | search | outline | section | single | done | error.
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
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const c = byId.get(seg.speaker);
      try {
        const { buffer } = await cachedSynthesize({
          text: seg.text,
          voiceId: c?.voiceId || undefined,
          speed: c?.speed,
          format: "mp3",
        });
        buffers.push(buffer);
      } catch (err) {
        throw new Error(`第 ${i + 1} 段配音失败：${err.message || err}`);
      }
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
  const chats = await listChats();
  res.json(
    chats.map((c) => ({
      ...c,
      mode: c.mode === "learn" ? "learn" : "casual",
      learning: c.learning || null,
    }))
  );
});

app.post("/api/chats", async (req, res) => {
  const chats = await listChats();
  const mode = req.body?.mode === "learn" ? "learn" : "casual";
  const characters = await listCharacters();
  const now = new Date().toISOString();

  let participantIds = [];
  let learning = null;
  let title = String(req.body?.title || "").trim();

  if (mode === "learn") {
    const body = req.body?.learning || req.body || {};
    const teacherId = String(body.teacherId || "").trim();
    const partnerIds = Array.isArray(body.partnerIds)
      ? [...new Set(body.partnerIds.map(String))].filter((id) => id && id !== teacherId).slice(0, 3)
      : [];
    if (!teacherId) return res.status(400).json({ error: "请选择主讲老师" });
    if (partnerIds.length < 1) return res.status(400).json({ error: "请选择 1~3 位 partner" });
    if (!characters.some((c) => c.id === teacherId)) {
      return res.status(400).json({ error: "主讲老师无效" });
    }
    if (partnerIds.some((id) => !characters.some((c) => c.id === id))) {
      return res.status(400).json({ error: "存在无效的 partner" });
    }
    const topic = String(body.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "请填写学习主题" });

    const partnerStyles = {};
    const rawStyles = body.partnerStyles && typeof body.partnerStyles === "object" ? body.partnerStyles : {};
    for (const id of partnerIds) {
      const s = String(rawStyles[id] || "");
      if (["challenger", "analogist", "pragmatist", "synthesizer", "devil"].includes(s)) {
        partnerStyles[id] = s;
      }
    }

    const granularity = ["coarse", "medium", "fine"].includes(body.granularity)
      ? body.granularity
      : "medium";
    const learnerLevel = ["beginner", "intermediate", "advanced"].includes(body.learnerLevel)
      ? body.learnerLevel
      : "beginner";

    participantIds = [teacherId, ...partnerIds];
    learning = {
      topic,
      materials: String(body.materials || ""),
      materialLinks: String(body.materialLinks || ""),
      goal: String(body.goal || ""),
      granularity,
      learnerLevel,
      teacherId,
      partnerIds,
      partnerStyles,
      plan: null,
      currentStepIndex: 0,
    };
    if (!title) title = "学习：" + topic;
  } else {
    participantIds = Array.isArray(req.body?.participantIds)
      ? req.body.participantIds.map(String)
      : [];
    if (participantIds.length === 0) return res.status(400).json({ error: "至少选择一个角色" });
    if (!title) {
      const names = participantIds
        .map((id) => characters.find((c) => c.id === id)?.name)
        .filter(Boolean);
      title = "和 " + names.join("、") + " 聊天";
    }
  }

  const chat = {
    id: newId("t"),
    title,
    mode,
    participantIds,
    model: String(req.body?.model || "claude-sonnet-4-6"),
    messages: [],
    learning,
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

/** Generate or regenerate the learning plan for a learn-mode chat. */
app.post("/api/chats/:id/learning-plan", async (req, res) => {
  const chats = await listChats();
  const idx = chats.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const chat = chats[idx];
  if (chat.mode !== "learn" || !chat.learning) {
    return res.status(400).json({ error: "仅学习模式可生成计划" });
  }

  try {
    const allCharacters = await listCharacters();
    const participants = allCharacters.filter((c) => chat.participantIds.includes(c.id));
    const plan = await generateLearningPlan(chat, participants);
    chat.learning = {
      ...chat.learning,
      plan,
      currentStepIndex: 0,
      partnerStyles: {
        ...(chat.learning.partnerStyles || {}),
        ...Object.fromEntries(plan.partnerAssignments.map((a) => [a.characterId, a.thinkingStyle])),
      },
    };
    if (!chat.title || chat.title.startsWith("学习：")) {
      chat.title = "学习：" + (plan.title || chat.learning.topic);
    }
    chat.updatedAt = new Date().toISOString();
    await saveChats(chats);
    res.json({ chat, plan });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** Advance (or jump to) a learning plan step. */
app.post("/api/chats/:id/learning-step", async (req, res) => {
  const chats = await listChats();
  const idx = chats.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const chat = chats[idx];
  if (chat.mode !== "learn" || !chat.learning?.plan?.steps?.length) {
    return res.status(400).json({ error: "没有可推进的学习计划" });
  }
  const steps = chat.learning.plan.steps;
  let next;
  if (Number.isFinite(Number(req.body?.stepIndex))) {
    next = Math.max(0, Math.min(steps.length - 1, Number(req.body.stepIndex)));
  } else {
    next = Math.min(steps.length - 1, (chat.learning.currentStepIndex || 0) + 1);
  }
  chat.learning.currentStepIndex = next;
  chat.learning.advanceReady = false;
  chat.learning.lastStepStatus = null;
  chat.updatedAt = new Date().toISOString();
  await saveChats(chats);
  res.json(chat);
});

// Send a user message; Claude replies in character.
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
    const result = await generateChatReplies(chat, participants, chat.messages, isEndless);
    const replies = result.replies || result;
    const replyMessages = (Array.isArray(replies) ? replies : []).map((r) => ({
      id: newId("m"),
      role: "character",
      characterId: r.characterId,
      text: r.text,
      emotion: r.emotion,
      ts: new Date().toISOString(),
    }));
    chat.messages.push(...replyMessages);

    if (chat.mode === "learn" && chat.learning) {
      chat.learning = {
        ...chat.learning,
        lastStepStatus: result.stepStatus || null,
        advanceReady: Boolean(result.advanceReady),
      };
    }

    chat.updatedAt = new Date().toISOString();
    await saveChats(chats);
    res.json({ chat, replies: replyMessages });
  } catch (err) {
    chat.updatedAt = new Date().toISOString();
    await saveChats(chats);
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Synthesize one clip with a disk cache. Cache key = hash(model + voice + speed
// + format + text) so replays and the player's look-ahead prefetch are instant
// and never re-bill an identical clip. `nocache` forces a fresh take (重配).
function ttsCacheKey({ text, voiceId, speed, format = "mp3" }) {
  const model = process.env.FISH_MODEL || "s2.1-pro-free";
  const ref = voiceId || process.env.FISH_DEFAULT_VOICE_ID || "";
  return createHash("sha1")
    .update([model, ref, speed || 1, format, text].join(" "))
    .digest("hex");
}

function ttsCachePath({ text, voiceId, speed, format = "mp3" }) {
  return join(AUDIO_DIR, `${ttsCacheKey({ text, voiceId, speed, format })}.${format}`);
}

async function cachedSynthesize({ text, voiceId, speed, format = "mp3", nocache = false }) {
  const contentType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
  const file = ttsCachePath({ text, voiceId, speed, format });
  if (!nocache && existsSync(file)) {
    return { buffer: await readFile(file), contentType, hit: true };
  }
  const out = await synthesize({ text, voiceId, speed, format });
  await writeFile(file, out.buffer);
  return { buffer: out.buffer, contentType: out.contentType || contentType, hit: false };
}

/** Batch-check which clips are already on disk (no audio bytes transferred). */
app.post("/api/tts/check", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: "items array required" });
  const hits = items.map((item) => {
    const text = String(item?.text || "").trim();
    if (!text) return false;
    return existsSync(
      ttsCachePath({
        text,
        voiceId: item.voiceId,
        speed: item.speed,
        format: item.format || "mp3",
      })
    );
  });
  res.json({ hits });
});

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
    backstory: String(body.backstory || ""),
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

function resolveEpisodeMode(body = {}) {
  return body.mode === "sitcom" ? "sitcom" : "podcast";
}

function sanitizeEpisode(body = {}) {
  return {
    title: String(body.title || "").trim(),
    mode: resolveEpisodeMode(body),
    topic: String(body.topic || ""),
    materials: String(body.materials || ""),
    materialLinks: String(body.materialLinks || ""),
    durationMinutes: Math.max(1, Number(body.durationMinutes) || 10),
    hostId: String(body.hostId || ""),
    guestIds: Array.isArray(body.guestIds) ? body.guestIds.map(String) : [],
    model: String(body.model || "claude-sonnet-4-6"),
    searchMode: resolveSearchMode(body),
    searchBrief: String(body.searchBrief || ""),
    basedOnEpisodeIds: Array.isArray(body.basedOnEpisodeIds) ? body.basedOnEpisodeIds.map(String) : [],
    storyBackground: String(body.storyBackground || ""),
    characterRelations: String(body.characterRelations || ""),
    narratorId: String(body.narratorId || ""),
    leadActorIds: Array.isArray(body.leadActorIds) ? body.leadActorIds.map(String) : [],
    plotDevelopment: String(body.plotDevelopment || ""),
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

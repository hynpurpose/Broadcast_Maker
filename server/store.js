import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, "data");
export const AUDIO_DIR = join(DATA_DIR, "audio");
const CHARACTERS_FILE = join(DATA_DIR, "characters.json");
const EPISODES_FILE = join(DATA_DIR, "episodes.json");
const CHATS_FILE = join(DATA_DIR, "chats.json");
const READINGS_FILE = join(DATA_DIR, "readings.json");

/** Serialize writes per file so concurrent mid-saves cannot corrupt JSON. */
const writeQueues = new Map();

async function ensureDirs() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(AUDIO_DIR)) await mkdir(AUDIO_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[store] failed to read ${file}:`, err?.message || err);
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDirs();
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      const payload = JSON.stringify(data, null, 2);
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, file);
    });
  writeQueues.set(
    file,
    next.finally(() => {
      if (writeQueues.get(file) === next) writeQueues.delete(file);
    })
  );
  return next;
}

export async function listCharacters() {
  return readJson(CHARACTERS_FILE, []);
}

export async function saveCharacters(characters) {
  await writeJson(CHARACTERS_FILE, characters);
}

export async function listEpisodes() {
  return readJson(EPISODES_FILE, []);
}

export async function saveEpisodes(episodes) {
  await writeJson(EPISODES_FILE, episodes);
}

export async function listChats() {
  return readJson(CHATS_FILE, []);
}

export async function saveChats(chats) {
  await writeJson(CHATS_FILE, chats);
}

export async function listReadings() {
  return readJson(READINGS_FILE, []);
}

/** Atomic read-modify-write for readings (serialized with other writes). */
export async function updateReadings(mutator) {
  await ensureDirs();
  const prev = writeQueues.get(READINGS_FILE) || Promise.resolve();
  let result;
  const next = prev.catch(() => {}).then(async () => {
    let list = [];
    try {
      const raw = await readFile(READINGS_FILE, "utf8");
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    result = await mutator(list);
    const tmp = `${READINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
    await rename(tmp, READINGS_FILE);
    return result;
  });
  writeQueues.set(
    READINGS_FILE,
    next.finally(() => {
      if (writeQueues.get(READINGS_FILE) === next) writeQueues.delete(READINGS_FILE);
    })
  );
  return next;
}

export async function saveReadings(readings) {
  await writeJson(READINGS_FILE, readings);
}

export function newId(prefix = "c") {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

await ensureDirs();

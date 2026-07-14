import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, "data");
export const AUDIO_DIR = join(DATA_DIR, "audio");
const CHARACTERS_FILE = join(DATA_DIR, "characters.json");
const EPISODES_FILE = join(DATA_DIR, "episodes.json");
const CHATS_FILE = join(DATA_DIR, "chats.json");

async function ensureDirs() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(AUDIO_DIR)) await mkdir(AUDIO_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDirs();
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
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

export function newId(prefix = "c") {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

await ensureDirs();

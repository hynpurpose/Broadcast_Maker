// Persist / load generation checkpoints so segmented script jobs can resume
// after server restart or mid-run failures. One JSON file per episode.

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./store.js";

const DIR = join(DATA_DIR, "gen-checkpoints");

async function ensureDir() {
  if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
}

function pathFor(episodeId) {
  return join(DIR, `${episodeId}.json`);
}

export async function loadCheckpoint(episodeId) {
  try {
    const raw = await readFile(pathFor(episodeId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveCheckpoint(episodeId, data) {
  await ensureDir();
  const payload = {
    ...data,
    episodeId,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(pathFor(episodeId), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export async function clearCheckpoint(episodeId) {
  try {
    await unlink(pathFor(episodeId));
  } catch {
    // ignore missing
  }
}

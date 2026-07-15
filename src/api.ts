import type { Character, CharacterDraft, Chat, ChatMessage, Episode, EpisodeDraft, GenProgress } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  uploadFile: (filename: string, base64: string) =>
    fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, base64 }),
    }).then((r) => json<{ url: string }>(r)),

  listCharacters: () => fetch("/api/characters").then((r) => json<Character[]>(r)),

  createCharacter: (draft: CharacterDraft) =>
    fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then((r) => json<Character>(r)),

  updateCharacter: (id: string, draft: CharacterDraft) =>
    fetch(`/api/characters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then((r) => json<Character>(r)),

  deleteCharacter: (id: string) =>
    fetch(`/api/characters/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  generateRandomCharacter: (opts: {
    education: "low" | "mid" | "high" | "elite" | "expert";
    personality: "gentle" | "soft" | "balanced" | "spicy" | "fierce";
    openness: "conservative" | "cautious" | "neutral" | "open" | "radical";
    expertField?: string;
  }) =>
    fetch("/api/characters/random", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    }).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error || r.statusText);
      return body as {
        name: string;
        persona: string;
        languageStyle: string;
        faction: string;
        backstory: string;
        defaultEmotion: string;
        speed: number;
      };
    }),

  polishCharacter: (draft: {
    name?: string;
    persona?: string;
    languageStyle?: string;
    faction?: string;
    backstory?: string;
    defaultEmotion?: string;
    speed?: number;
  }) =>
    fetch("/api/characters/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error || r.statusText);
      return body as {
        name: string;
        persona: string;
        languageStyle: string;
        faction: string;
        backstory: string;
        defaultEmotion: string;
        speed: number;
      };
    }),

  polishTopic: (draft: { topic: string; title?: string; materials?: string }) =>
    fetch("/api/episodes/polish-topic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error || r.statusText);
      return body as { topic: string };
    }),

  listEpisodes: () => fetch("/api/episodes").then((r) => json<Episode[]>(r)),

  createEpisode: (draft: EpisodeDraft) =>
    fetch("/api/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then((r) => json<Episode>(r)),

  updateEpisode: (id: string, draft: EpisodeDraft) =>
    fetch(`/api/episodes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then((r) => json<Episode>(r)),

  deleteEpisode: (id: string) =>
    fetch(`/api/episodes/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  /** Starts generation (returns immediately; poll getGenProgress for completion).
   *  force=true discards checkpoint and restarts from scratch.
   *  If already running, resolves with { busy: true, progress } so UI can re-attach polling. */
  startGenerate: async (id: string, opts: { force?: boolean } = {}) => {
    const r = await fetch(`/api/episodes/${id}/generate-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const body = await r.json().catch(() => ({} as Record<string, unknown>));
    if (r.status === 409 && (body as { busy?: boolean })?.busy) {
      return {
        busy: true as const,
        progress: ((body as { progress?: GenProgress }).progress || null) as GenProgress | null,
      };
    }
    if (!r.ok) {
      const err = (body as { error?: string })?.error;
      throw new Error(err || "启动生成失败");
    }
    return {
      busy: false as const,
      started: true as const,
      resumed: Boolean((body as { resumed?: boolean })?.resumed),
      progress: null as GenProgress | null,
    };
  },

  getGenProgress: (id: string) =>
    fetch(`/api/episodes/${id}/gen-progress`).then((r) => json<GenProgress | null>(r)),

  updateSegment: (id: string, index: number, patch: { text?: string; emotion?: string }) =>
    fetch(`/api/episodes/${id}/segments/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Episode>(r)),

  listChats: () => fetch("/api/chats").then((r) => json<Chat[]>(r)),

  createChat: (draft: { title?: string; participantIds: string[]; model: string }) =>
    fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then((r) => json<Chat>(r)),

  deleteChat: (id: string) =>
    fetch(`/api/chats/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  sendChatMessage: (id: string, text: string, isEndless?: boolean) =>
    fetch(`/api/chats/${id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, isEndless }),
    }).then((r) => json<{ chat: Chat; replies: ChatMessage[] }>(r)),

  /** Downloads the whole episode as one mp3 (returns a blob). */
  async exportEpisode(id: string): Promise<Blob> {
    const res = await fetch(`/api/episodes/${id}/export`);
    if (!res.ok) throw new Error((await res.text()) || "导出失败");
    return res.blob();
  },

  /** Returns an object URL for the synthesized audio. `nocache` forces a fresh take. */
  async tts(
    text: string,
    opts: { voiceId?: string; speed?: number; nocache?: boolean; signal?: AbortSignal } = {}
  ): Promise<string> {
    const { signal, ...body } = opts;
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...body }),
      signal,
    });
    if (!res.ok) throw new Error((await res.text()) || "TTS failed");
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  /** Check which clips are already on the server disk cache (no audio download). */
  checkTtsCache: (
    items: Array<{ text: string; voiceId?: string; speed?: number }>
  ) =>
    fetch("/api/tts/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error || r.statusText);
      return body as { hits: boolean[] };
    }),
};

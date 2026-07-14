export interface Character {
  id: string;
  name: string;
  /** 性格特点 */
  persona: string;
  /** 语言特色 / 口头禅 */
  languageStyle: string;
  /** 观点阵营 / 立场 */
  faction: string;
  /** Fish Audio reference_id（绑定音色） */
  voiceId: string;
  /** 语速倍率，默认 1 */
  speed: number;
  /** 默认情感基调，可选 */
  defaultEmotion: string;
  /** 头像 URL，可选 */
  avatar?: string;
}

export type CharacterDraft = Omit<Character, "id">;

export interface ScriptSegment {
  speaker: string; // character id
  text: string; // 含 Fish 标签
  emotion?: string;
}

export interface Script {
  title?: string;
  segments: ScriptSegment[];
  truncated?: boolean;
}

export type EpisodeStatus = "draft" | "script_ready";

/** Mid-generation snapshot — survives restarts; used to resume. */
export interface GenCheckpoint {
  materials: string;
  searchSources: SearchSource[];
  urlsFetched: boolean;
  searchDone: boolean;
  outline?: { title?: string; sections: Array<{ title: string; focus: string }> };
  segments: ScriptSegment[];
  nextSectionIndex: number;
  sectionCount: number;
  scriptTitle?: string;
  updatedAt: string;
}

/** 联网搜索模式：关闭 / 普通 Google Search / Deep Research / Deep Research Max */
export type SearchMode = "off" | "google" | "deep_research" | "deep_research_max";

export interface SearchSource {
  title: string;
  url: string;
}

export interface GenProgress {
  phase: "fetch_urls" | "search" | "outline" | "section" | "single" | "done" | "error";
  current?: number;
  total?: number;
  error?: string;
  /** server heartbeat; used to detect stale/orphan jobs */
  updatedAt?: string;
}

export interface Episode {
  id: string;
  title: string;
  topic: string;
  materials: string;
  /** 参考链接，每行一个 URL（写稿前自动抓取） */
  materialLinks: string;
  durationMinutes: number;
  hostId: string;
  guestIds: string[];
  /** 写稿模型 id，如 claude-sonnet-4-6 / claude-opus-4-8 */
  model: string;
  /** 生成前联网搜索模式 */
  searchMode: SearchMode;
  /** 可选：联网/深研时想查清什么、关注角度等 */
  searchBrief: string;
  searchSources?: SearchSource[];
  /** 未完成的生成检查点（有则可续跑） */
  genCheckpoint?: GenCheckpoint | null;
  /** 基于哪些往期节目的内容来延续创作 */
  basedOnEpisodeIds: string[];
  status: EpisodeStatus;
  script: Script | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "character";
  characterId?: string;
  text: string;
  ts: string;
  emotion?: string;
}

export interface Chat {
  id: string;
  title: string;
  participantIds: string[];
  model: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export type EpisodeDraft = Pick<
  Episode,
  | "title"
  | "topic"
  | "materials"
  | "materialLinks"
  | "durationMinutes"
  | "hostId"
  | "guestIds"
  | "model"
  | "searchMode"
  | "searchBrief"
  | "basedOnEpisodeIds"
>;

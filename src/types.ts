export interface Character {
  id: string;
  name: string;
  /** 性格特点 */
  persona: string;
  /** 语言特色 / 口头禅 */
  languageStyle: string;
  /** 观点阵营 / 立场 */
  faction: string;
  /** 过往经历 */
  backstory: string;
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

/** 节目模式：播客对谈 / 情景剧 */
export type EpisodeMode = "podcast" | "sitcom";

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
  /** 节目模式，默认 podcast */
  mode: EpisodeMode;
  topic: string;
  materials: string;
  /** 参考链接，每行一个 URL（写稿前自动抓取） */
  materialLinks: string;
  durationMinutes: number;
  hostId: string;
  guestIds: string[];
  /** 写稿模型 id，如 claude-sonnet-4-6 / claude-opus-4-8 / gemini-3.5-flash */
  model: string;
  /** 生成前联网搜索模式 */
  searchMode: SearchMode;
  /** 可选：联网/深研时想查清什么、关注角度等 */
  searchBrief: string;
  searchSources?: SearchSource[];
  /** 表单侧已完成独立调研；为 true 时生成脚本不再重新搜索 */
  searchDone?: boolean;
  /** 未完成的生成检查点（有则可续跑） */
  genCheckpoint?: GenCheckpoint | null;
  /** 基于哪些往期节目的内容来延续创作 */
  basedOnEpisodeIds: string[];
  /** 情景剧模式：故事背景 */
  storyBackground: string;
  /** 情景剧模式：人物关系 */
  characterRelations: string;
  /** 情景剧模式：旁白/主讲人 ID */
  narratorId: string;
  /** 情景剧模式：主演角色 IDs */
  leadActorIds: string[];
  /** 情景剧模式：情节发展 */
  plotDevelopment: string;
  status: EpisodeStatus;
  script: Script | null;
  createdAt: string;
  updatedAt: string;
}

export type ChatMessageKind = "speech" | "citation" | "quiz" | "system";

export type QuizType = "choice" | "truefalse" | "fill";

export type QuizStatus = "pending" | "answered" | "skipped";

export type LearnAction =
  | "ask_teacher"
  | "discuss"
  | "want_example"
  | "too_hard"
  | "too_easy"
  | "recap";

export interface CitationPayload {
  title: string;
  url?: string;
  excerpt: string;
  note?: string;
}

export interface QuizPayload {
  quizType: QuizType;
  prompt: string;
  /** choice: 选项文案；truefalse 可省略 */
  options?: string[];
  /** 参考答案（填空/选择的正确项文案或 true/false）；批改用，可对用户隐藏到作答后 */
  answer?: string;
  explanation?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "character" | "system";
  characterId?: string;
  /** 默认 speech；旧消息无 kind 时按 speech */
  kind?: ChatMessageKind;
  text: string;
  ts: string;
  emotion?: string;
  citation?: CitationPayload;
  quiz?: QuizPayload;
  quizStatus?: QuizStatus;
  quizResponse?: string;
}

/** 对话模式：闲聊 / 学习 */
export type ChatMode = "casual" | "learn";

/** 学习计划颗粒度 */
export type LearningGranularity = "coarse" | "medium" | "fine";

/** 学习者当前水平 */
export type LearnerLevel = "beginner" | "intermediate" | "advanced";

/** Partner 思维角色（与人设叠加，决定在学习中怎么说话） */
export type PartnerThinkingStyle =
  | "challenger"
  | "analogist"
  | "pragmatist"
  | "synthesizer"
  | "devil";

export interface LearningPlanStep {
  id: string;
  title: string;
  /** 本步要让学习者掌握什么 */
  objective: string;
  /** 关键讲解/练习要点 */
  keyPoints: string[];
  /** 如何判断本步已掌握（老师用来决定是否推进） */
  checkHint: string;
}

export interface LearningPartnerAssignment {
  characterId: string;
  thinkingStyle: PartnerThinkingStyle;
  /** 本计划中该 partner 的具体职责一句话 */
  duty: string;
}

export interface LearningPlan {
  title: string;
  summary: string;
  /** 预估对话轮次（约） */
  estimatedRounds: number;
  steps: LearningPlanStep[];
  partnerAssignments: LearningPartnerAssignment[];
}

export interface LearningConfig {
  topic: string;
  materials: string;
  materialLinks: string;
  goal: string;
  granularity: LearningGranularity;
  learnerLevel: LearnerLevel;
  teacherId: string;
  partnerIds: string[];
  /** partnerId → 思维风格；未填则生成计划时自动分配 */
  partnerStyles: Record<string, PartnerThinkingStyle>;
  /** 与节目页相同的联网搜索档位 */
  searchMode: SearchMode;
  /** 可选：想查清什么、关注角度等 */
  searchBrief: string;
  searchSources?: SearchSource[];
  /** 是否已完成联网搜索（避免重复搜） */
  searchDone?: boolean;
  plan: LearningPlan | null;
  /** 当前进行到计划第几步（0-based） */
  currentStepIndex: number;
  /** 上一轮模型判断：是否可进入下一步 */
  advanceReady?: boolean;
  lastStepStatus?: string | null;
}

export interface Chat {
  id: string;
  title: string;
  mode: ChatMode;
  participantIds: string[];
  model: string;
  messages: ChatMessage[];
  /** 仅 mode=learn 时有值 */
  learning?: LearningConfig | null;
  createdAt: string;
  updatedAt: string;
}

/** 学习计划生成进度（联网搜索 / 写计划） */
export interface LearnPlanProgress {
  phase: "fetch_urls" | "search" | "plan" | "done" | "error";
  error?: string;
  searchMode?: SearchMode;
  updatedAt?: string;
  /** done 时附带最新 chat */
  chat?: Chat;
  plan?: LearningPlan;
}

export type ChatDraft = {
  title?: string;
  mode: ChatMode;
  model: string;
  /** casual：任意多选；learn：由 teacher + partners 推导 */
  participantIds?: string[];
  learning?: Omit<
    LearningConfig,
    "plan" | "currentStepIndex" | "advanceReady" | "lastStepStatus" | "searchSources" | "searchDone"
  >;
};

export type EpisodeDraft = Pick<
  Episode,
  | "title"
  | "mode"
  | "topic"
  | "materials"
  | "materialLinks"
  | "durationMinutes"
  | "hostId"
  | "guestIds"
  | "model"
  | "searchMode"
  | "searchBrief"
  | "searchDone"
  | "searchSources"
  | "basedOnEpisodeIds"
  | "storyBackground"
  | "characterRelations"
  | "narratorId"
  | "leadActorIds"
  | "plotDevelopment"
>;

export type EpisodePolishField =
  | "topic"
  | "storyBackground"
  | "characterRelations"
  | "plotDevelopment";

export type ResearchJobProgress = {
  phase: "search" | "done" | "error";
  searchMode?: SearchMode;
  error?: string;
  materials?: string;
  materialLinks?: string;
  searchSources?: SearchSource[];
  searchDone?: boolean;
  updatedAt?: string;
};

/** 文章精读项目 */
export type ReadingStatus = "draft" | "script_ready";

export interface ReadingParagraph {
  index: number;
  text: string;
}

export interface Reading {
  id: string;
  title: string;
  articleText: string;
  articleUrl: string;
  /** 文章语言，如 zh / en / de / ja / fr / es */
  articleLanguage: string;
  /** 朗读者：台词使用文章语言 */
  readerId: string;
  /** 讲解者 */
  explainerId: string;
  /** 讲解语言，可与文章语言不同 */
  explainerLanguage: string;
  model: string;
  status: ReadingStatus;
  paragraphs: ReadingParagraph[] | null;
  script: Script | null;
  createdAt: string;
  updatedAt: string;
}

export type ReadingDraft = Pick<
  Reading,
  | "title"
  | "articleText"
  | "articleUrl"
  | "articleLanguage"
  | "readerId"
  | "explainerId"
  | "explainerLanguage"
  | "model"
>;

export interface ReadingGenProgress {
  phase: "split" | "script" | "done" | "error";
  current?: number;
  total?: number;
  error?: string;
  /** human-readable status for UI */
  message?: string;
  updatedAt?: string;
}

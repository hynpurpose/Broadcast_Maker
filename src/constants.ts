export const EPISODE_MODES = [
  { id: "podcast", label: "播客对谈" },
  { id: "sitcom", label: "情景剧" },
] as const;

export const DEFAULT_MODE = EPISODE_MODES[0].id;

export const CHAT_MODES = [
  { id: "casual", label: "闲聊" },
  { id: "learn", label: "学习模式" },
] as const;

export const DEFAULT_CHAT_MODE = CHAT_MODES[0].id;

export const LEARNING_GRANULARITIES = [
  { id: "coarse", label: "粗颗粒（3–5 大步，快速过一遍）" },
  { id: "medium", label: "中等（6–10 步，讲练结合）" },
  { id: "fine", label: "细颗粒（10–16 步，含检验与小结）" },
] as const;

export const DEFAULT_LEARNING_GRANULARITY = LEARNING_GRANULARITIES[1].id;

export const LEARNER_LEVELS = [
  { id: "beginner", label: "零基础" },
  { id: "intermediate", label: "有一些基础" },
  { id: "advanced", label: "想深入/查漏补缺" },
] as const;

export const DEFAULT_LEARNER_LEVEL = LEARNER_LEVELS[0].id;

export const PARTNER_THINKING_STYLES = [
  { id: "challenger", label: "质疑者 — 追问漏洞，逼你想清楚" },
  { id: "analogist", label: "类比者 — 用生活例子把概念讲透" },
  { id: "pragmatist", label: "实践者 — 强调怎么用、怎么练" },
  { id: "synthesizer", label: "总结者 — 帮你归纳框架与对照表" },
  { id: "devil", label: "唱反调 — 故意抬杠，加深印象" },
] as const;

export const DEFAULT_PARTNER_STYLES = [
  "challenger",
  "analogist",
  "pragmatist",
] as const;

export const SCRIPT_MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6（快、便宜）" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8（更强、更生动）" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash（快、便宜）" },
] as const;

export const DEFAULT_MODEL = SCRIPT_MODELS[0].id;

export const SEARCH_MODES = [
  { id: "off", label: "关闭" },
  { id: "google", label: "Google Search（普通联网）" },
  { id: "deep_research", label: "Deep Research" },
  { id: "deep_research_max", label: "Deep Research Max" },
] as const;

export const DEFAULT_SEARCH_MODE = SEARCH_MODES[0].id;

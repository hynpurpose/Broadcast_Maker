export const SCRIPT_MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6（快、便宜）" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8（更强、更生动）" },
] as const;

export const DEFAULT_MODEL = SCRIPT_MODELS[0].id;

export const SEARCH_MODES = [
  { id: "off", label: "关闭" },
  { id: "google", label: "Google Search（普通联网）" },
  { id: "deep_research", label: "Deep Research" },
  { id: "deep_research_max", label: "Deep Research Max" },
] as const;

export const DEFAULT_SEARCH_MODE = SEARCH_MODES[0].id;

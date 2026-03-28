const RAW_MODEL_MANIFEST = {
  opus: {
    id: "anthropic/claude-opus-4.6",
    short: "Opus 4.6",
    tier: "PREMIUM",
    inputCost: 5,
    outputCost: 25,
    contextWindow: 1_000_000,
    modalities: ["text", "image"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["safe", "coding", "research"]
  },
  sonnet: {
    id: "anthropic/claude-sonnet-4.6",
    short: "Sonnet 4.6",
    tier: "STANDARD",
    inputCost: 3,
    outputCost: 15,
    contextWindow: 1_000_000,
    modalities: ["text", "image"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["safe", "coding", "research", "vision"]
  },
  m27: {
    id: "minimax/minimax-m2.7",
    short: "MiniMax M2.7",
    tier: "VALUE",
    inputCost: 0.3,
    outputCost: 1.2,
    contextWindow: 200_000,
    modalities: ["text"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["auto", "coding", "research", "strict-json"]
  },
  m25: {
    id: "minimax/minimax-m2.5",
    short: "MiniMax M2.5",
    tier: "BUDGET-VALUE",
    inputCost: 0.3,
    outputCost: 1.1,
    contextWindow: 196_608,
    modalities: ["text"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["cheap", "fallback"]
  },
  kimiK25: {
    id: "moonshotai/kimi-k2.5",
    short: "Kimi K2.5",
    tier: "VALUE",
    inputCost: 0.45,
    outputCost: 2.2,
    contextWindow: 262_144,
    modalities: ["text", "image"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["vision", "auto", "research"]
  },
  kimiThinking: {
    id: "moonshotai/kimi-k2-thinking",
    short: "Kimi K2 Thinking",
    tier: "VALUE",
    inputCost: 0.47,
    outputCost: 2,
    contextWindow: 131_072,
    modalities: ["text"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["research", "auto"]
  },
  glm5: {
    id: "z-ai/glm-5",
    short: "GLM 5",
    tier: "VALUE",
    inputCost: 0.95,
    outputCost: 2.55,
    contextWindow: 204_800,
    modalities: ["text"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["strict-json", "coding", "auto"]
  },
  grok: {
    id: "x-ai/grok-4.1-fast",
    short: "Grok 4.1 Fast",
    tier: "BUDGET",
    inputCost: 0.2,
    outputCost: 0.5,
    contextWindow: 2_000_000,
    modalities: ["text", "image"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["cheap", "auto"]
  },
  dsCoder: {
    id: "deepseek/deepseek-v3.2",
    short: "DeepSeek V3.2",
    tier: "ULTRA-CHEAP",
    inputCost: 0.25,
    outputCost: 0.4,
    contextWindow: 163_840,
    modalities: ["text"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["cheap", "coding"]
  },
  gpt54: {
    id: "openai/gpt-5.4",
    short: "GPT-5.4",
    tier: "PREMIUM",
    inputCost: 2.5,
    outputCost: 15,
    contextWindow: 1_050_000,
    modalities: ["text", "image"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["safe", "research", "coding"]
  },
  gpt54Mini: {
    id: "openai/gpt-5.4-mini",
    short: "GPT-5.4 Mini",
    tier: "BUDGET",
    inputCost: 0.25,
    outputCost: 2,
    contextWindow: 400_000,
    modalities: ["text", "image", "file"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["strict-json", "cheap", "auto"]
  },
  gpt54Nano: {
    id: "openai/gpt-5.4-nano",
    short: "GPT-5.4 Nano",
    tier: "ULTRA-CHEAP",
    inputCost: 0.05,
    outputCost: 0.4,
    contextWindow: 400_000,
    modalities: ["text", "image", "file"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["cheap", "control"]
  },
  gem25FlashLite: {
    id: "google/gemini-2.5-flash-lite",
    short: "Gemini 2.5 Flash Lite",
    tier: "BUDGET",
    inputCost: 0.1,
    outputCost: 0.4,
    contextWindow: 1_048_576,
    modalities: ["text", "image", "audio"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["vision", "cheap"]
  },
  gem25Pro: {
    id: "google/gemini-2.5-pro",
    short: "Gemini 2.5 Pro",
    tier: "MID-TIER",
    inputCost: 1.25,
    outputCost: 10,
    contextWindow: 1_048_576,
    modalities: ["text", "image", "audio"],
    preview: false,
    toolReady: true,
    longContext: true,
    laneTags: ["vision", "research"]
  },
  gem31FlashLite: {
    id: "google/gemini-3.1-flash-lite-preview",
    short: "Gemini 3.1 Flash Lite Preview",
    tier: "BUDGET",
    inputCost: 0.25,
    outputCost: 1.5,
    contextWindow: 1_048_576,
    modalities: ["text", "image", "audio"],
    preview: true,
    toolReady: true,
    longContext: true,
    laneTags: ["vision", "cheap"]
  },
  gem31Pro: {
    id: "google/gemini-3.1-pro-preview",
    short: "Gemini 3.1 Pro Preview",
    tier: "MID-TIER",
    inputCost: 2,
    outputCost: 12,
    contextWindow: 1_048_576,
    modalities: ["text", "image", "audio"],
    preview: true,
    toolReady: true,
    longContext: true,
    laneTags: ["vision", "research"]
  }
};

const MODEL_ALIASES = {
  nano: "gpt54Nano",
  mini: "gpt54Mini",
  gemFlash: "gem31FlashLite"
};

const VIRTUAL_MODEL_MANIFEST = {
  "astrolabe/auto": {
    id: "astrolabe/auto",
    type: "virtual",
    lane: "auto",
    name: "Astrolabe Auto",
    description: "OpenClaw-first default lane with m27 as the general workhorse."
  },
  "astrolabe/coding": {
    id: "astrolabe/coding",
    type: "virtual",
    lane: "coding",
    name: "Astrolabe Coding",
    description: "Coding lane optimized for implementation, debugging, and repo work."
  },
  "astrolabe/research": {
    id: "astrolabe/research",
    type: "virtual",
    lane: "research",
    name: "Astrolabe Research",
    description: "Long-horizon synthesis lane with Kimi Thinking and m27."
  },
  "astrolabe/vision": {
    id: "astrolabe/vision",
    type: "virtual",
    lane: "vision",
    name: "Astrolabe Vision",
    description: "Multimodal lane for screenshots, files, and visual coding."
  },
  "astrolabe/strict-json": {
    id: "astrolabe/strict-json",
    type: "virtual",
    lane: "strict-json",
    name: "Astrolabe Strict JSON",
    description: "Structured-output lane that prioritizes schema and tool reliability."
  },
  "astrolabe/cheap": {
    id: "astrolabe/cheap",
    type: "virtual",
    lane: "cheap",
    name: "Astrolabe Cheap",
    description: "Low-cost lane for easy, trusted, low-risk turns."
  },
  "astrolabe/safe": {
    id: "astrolabe/safe",
    type: "virtual",
    lane: "safe",
    name: "Astrolabe Safe",
    description: "Premium safety lane for high-stakes or approval-sensitive work."
  }
};

const LANE_MANIFEST = {
  auto: {
    id: "astrolabe/auto",
    defaultCandidates: ["m27", "glm5", "kimiThinking", "kimiK25", "sonnet", "opus"],
    fallbackCandidates: ["m25", "grok", "gpt54Mini"],
    description: "Category-driven default lane."
  },
  coding: {
    id: "astrolabe/coding",
    defaultCandidates: ["m27", "glm5", "sonnet", "opus"],
    fallbackCandidates: ["m25", "dsCoder"],
    description: "Coding lane."
  },
  research: {
    id: "astrolabe/research",
    defaultCandidates: ["kimiThinking", "m27", "gem31Pro", "sonnet", "opus"],
    fallbackCandidates: ["m25", "gpt54"],
    description: "Deep research lane."
  },
  vision: {
    id: "astrolabe/vision",
    defaultCandidates: ["kimiK25", "gem31FlashLite", "gem31Pro", "sonnet"],
    fallbackCandidates: ["gem25Pro", "gpt54"],
    description: "Multimodal lane."
  },
  "strict-json": {
    id: "astrolabe/strict-json",
    defaultCandidates: ["glm5", "m27", "gpt54Mini", "sonnet"],
    fallbackCandidates: ["m25", "gpt54"],
    description: "Structured-output lane."
  },
  cheap: {
    id: "astrolabe/cheap",
    defaultCandidates: ["grok", "m25", "dsCoder", "gpt54Nano"],
    fallbackCandidates: ["gpt54Mini", "m27"],
    description: "Cost-sensitive lane."
  },
  safe: {
    id: "astrolabe/safe",
    defaultCandidates: ["sonnet", "opus"],
    fallbackCandidates: ["gpt54"],
    description: "High-safety lane."
  }
};

const CATEGORY_POLICIES = [
  {
    id: "heartbeat",
    name: "Heartbeat & Maintenance",
    injectionRisk: "LOW",
    classifierSignals: ["heartbeat", "ping", "status", "health_check", "alive", "compaction", "session_health"]
  },
  {
    id: "core_loop",
    name: "Core Agent Loop",
    injectionRisk: "HIGH",
    classifierSignals: ["tool_use", "function_call", "react_loop", "tool_selection", "retry", "confidence_check"]
  },
  {
    id: "retrieval",
    name: "Info Retrieval & Lookup",
    injectionRisk: "MEDIUM-HIGH",
    classifierSignals: ["calendar", "email_search", "web_search", "web_fetch", "memory_search", "weather", "lookup", "find"]
  },
  {
    id: "summarization",
    name: "Summarization & Extraction",
    injectionRisk: "MEDIUM",
    classifierSignals: ["summarize", "extract", "digest", "key_points", "receipt", "invoice", "action_items"]
  },
  {
    id: "planning",
    name: "Planning & Task Breakdown",
    injectionRisk: "MEDIUM-HIGH",
    classifierSignals: ["plan", "break_down", "schedule", "steps", "itinerary", "workflow", "sub_agent", "coordinate"]
  },
  {
    id: "orchestration",
    name: "Multi-Step Tool Orchestration",
    injectionRisk: "HIGH",
    classifierSignals: ["browser", "automation", "shell", "git", "multi_step", "checkout", "form_fill", "sequential"]
  },
  {
    id: "coding",
    name: "Software Engineering",
    injectionRisk: "HIGH",
    classifierSignals: ["code", "debug", "refactor", "test", "function", "script", "git_commit", "pr_review", "architecture"]
  },
  {
    id: "research",
    name: "Deep Research & Synthesis",
    injectionRisk: "HIGH",
    classifierSignals: ["research", "analysis", "synthesize", "literature", "competitive", "report", "deep_dive", "compare"]
  },
  {
    id: "creative",
    name: "Creative & Open-Ended",
    injectionRisk: "LOW",
    classifierSignals: ["brainstorm", "creative", "story", "write", "copy", "ideas", "design", "blog", "poem"]
  },
  {
    id: "communication",
    name: "Communication & Messaging",
    injectionRisk: "MEDIUM",
    classifierSignals: ["message", "reply", "chat", "email_reply", "slack", "negotiate", "support", "conversation"]
  },
  {
    id: "high_stakes",
    name: "High-Stakes / Sensitive",
    injectionRisk: "CRITICAL",
    classifierSignals: [
      "payment",
      "invoice",
      "transfer",
      "contract",
      "legal",
      "password",
      "pii",
      "health",
      "sensitive",
      "irreversible"
    ]
  },
  {
    id: "reflection",
    name: "Reflection & Self-Improvement",
    injectionRisk: "MEDIUM",
    classifierSignals: ["reflect", "debug_self", "stuck", "loop_detected", "failure", "improve", "learn", "retry_strategy"]
  }
];

const CATEGORY_BY_ID = new Map(CATEGORY_POLICIES.map((category) => [category.id, category]));
const CATEGORY_IDS = CATEGORY_POLICIES.map((category) => category.id);
const COMPLEXITY_ORDER = ["simple", "standard", "complex", "critical"];

const MODEL_FALLBACKS = {
  gpt54Nano: ["gpt54Mini", "grok", "m25", "m27"],
  gpt54Mini: ["grok", "m25", "m27", "glm5", "sonnet"],
  grok: ["m25", "m27", "gpt54Mini", "glm5", "sonnet"],
  dsCoder: ["m25", "m27", "glm5", "sonnet"],
  m25: ["m27", "glm5", "kimiK25", "sonnet", "opus"],
  m27: ["glm5", "kimiThinking", "kimiK25", "gem31Pro", "sonnet", "opus", "m25"],
  kimiK25: ["gem31FlashLite", "gem31Pro", "m27", "sonnet", "opus"],
  kimiThinking: ["m27", "gem31Pro", "sonnet", "opus"],
  glm5: ["m27", "m25", "sonnet", "opus"],
  gem31FlashLite: ["kimiK25", "gem31Pro", "sonnet", "gpt54"],
  gem31Pro: ["kimiK25", "m27", "sonnet", "opus"],
  gem25Pro: ["gem31Pro", "kimiK25", "sonnet"],
  sonnet: ["opus", "gpt54", "m27"],
  opus: ["sonnet", "gpt54", "m27"],
  gpt54: ["sonnet", "opus", "m27"]
};

const ESCALATION_PATH = {
  gpt54Nano: "gpt54Mini",
  gpt54Mini: "grok",
  grok: "m25",
  dsCoder: "m25",
  m25: "m27",
  m27: "sonnet",
  kimiK25: "sonnet",
  kimiThinking: "sonnet",
  glm5: "sonnet",
  gem31FlashLite: "gem31Pro",
  gem31Pro: "sonnet",
  sonnet: "opus",
  gpt54: "opus",
  opus: null
};

const MULTIMODAL_FALLBACK_KEYS = ["kimiK25", "gem31FlashLite", "gem31Pro", "sonnet", "gpt54"];

const pricePer1M = Object.fromEntries(
  Object.values(RAW_MODEL_MANIFEST).map((model) => [model.id, { input: model.inputCost, output: model.outputCost }])
);

function resolveModelAlias(key) {
  return MODEL_ALIASES[key] || key;
}

function modelEntryForKey(key) {
  const resolved = resolveModelAlias(String(key || "").trim());
  return RAW_MODEL_MANIFEST[resolved] || null;
}

function modelIdForKey(key) {
  return modelEntryForKey(key)?.id || null;
}

function modelShortForKey(key) {
  return modelEntryForKey(key)?.short || String(key || "custom");
}

function resolveModelKeyFromId(modelId) {
  for (const [key, model] of Object.entries(RAW_MODEL_MANIFEST)) {
    if (model.id === modelId) return key;
  }
  return null;
}

function rawModelsList() {
  return Object.entries(RAW_MODEL_MANIFEST).map(([key, model]) => ({
    key,
    ...model,
    aliases: Object.entries(MODEL_ALIASES)
      .filter(([, value]) => value === key)
      .map(([alias]) => alias)
  }));
}

function virtualModelsList() {
  return Object.values(VIRTUAL_MODEL_MANIFEST);
}

module.exports = {
  CATEGORY_BY_ID,
  CATEGORY_IDS,
  CATEGORY_POLICIES,
  COMPLEXITY_ORDER,
  ESCALATION_PATH,
  LANE_MANIFEST,
  MODEL_ALIASES,
  MODEL_FALLBACKS,
  MULTIMODAL_FALLBACK_KEYS,
  RAW_MODEL_MANIFEST,
  VIRTUAL_MODEL_MANIFEST,
  modelEntryForKey,
  modelIdForKey,
  modelShortForKey,
  pricePer1M,
  rawModelsList,
  resolveModelAlias,
  resolveModelKeyFromId,
  virtualModelsList
};

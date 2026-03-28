const COMPLEXITY_ORDER = ["simple", "standard", "complex", "critical"];

const CATEGORY_POLICIES = [
  {
    id: "heartbeat",
    name: "Heartbeat",
    injectionRisk: "LOW",
    classifierSignals: ["ping", "health", "heartbeat", "status", "alive"]
  },
  {
    id: "core_loop",
    name: "Core Loop",
    injectionRisk: "MEDIUM",
    classifierSignals: ["continue", "next step", "work on this", "ongoing task", "session"]
  },
  {
    id: "retrieval",
    name: "Retrieval",
    injectionRisk: "LOW",
    classifierSignals: ["find", "lookup", "retrieve", "search", "fetch"]
  },
  {
    id: "summarization",
    name: "Summarization",
    injectionRisk: "LOW",
    classifierSignals: ["summarize", "digest", "key points", "extract", "brief"]
  },
  {
    id: "planning",
    name: "Planning",
    injectionRisk: "MEDIUM",
    classifierSignals: ["plan", "roadmap", "steps", "milestones", "approach"]
  },
  {
    id: "orchestration",
    name: "Orchestration",
    injectionRisk: "MEDIUM-HIGH",
    classifierSignals: ["coordinate", "delegate", "workflow", "automation", "sequence"]
  },
  {
    id: "coding",
    name: "Coding",
    injectionRisk: "MEDIUM-HIGH",
    classifierSignals: ["code", "debug", "stack trace", "refactor", "patch", "test"]
  },
  {
    id: "research",
    name: "Research",
    injectionRisk: "MEDIUM",
    classifierSignals: ["research", "compare", "analysis", "citations", "sources", "synthesize"]
  },
  {
    id: "creative",
    name: "Creative",
    injectionRisk: "LOW",
    classifierSignals: ["brainstorm", "story", "copy", "creative", "tagline"]
  },
  {
    id: "communication",
    name: "Communication",
    injectionRisk: "LOW",
    classifierSignals: ["reply", "message", "email", "respond", "draft"]
  },
  {
    id: "high_stakes",
    name: "High Stakes",
    injectionRisk: "CRITICAL",
    classifierSignals: ["approve", "transfer", "delete", "deploy", "legal", "medical", "sensitive"]
  },
  {
    id: "reflection",
    name: "Reflection",
    injectionRisk: "MEDIUM",
    classifierSignals: ["reflect", "retrospective", "postmortem", "improve", "self-check"]
  }
];

const CATEGORY_BY_ID = new Map(CATEGORY_POLICIES.map((policy) => [policy.id, policy]));
const CATEGORY_IDS = CATEGORY_POLICIES.map((policy) => policy.id);

function createModelEntry(key, values) {
  return {
    key,
    aliases: [],
    activeDefault: false,
    rawOnly: false,
    preview: false,
    toolReady: true,
    longContext: false,
    multimodal: false,
    supportedParameters: [],
    laneTags: [],
    roleTags: [],
    ...values
  };
}

const RAW_MODEL_MANIFEST = {
  gpt5Nano: createModelEntry("gpt5Nano", {
    id: "openai/gpt-5-nano",
    short: "GPT-5 Nano",
    tier: "CONTROL",
    inputCost: 0.05,
    outputCost: 0.4,
    contextWindow: 400000,
    modalities: ["text"],
    activeDefault: true,
    roleTags: ["router", "classifier", "lightweight_verifier", "cheap_extraction"],
    laneTags: ["control", "cheap"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gpt54Nano: createModelEntry("gpt54Nano", {
    id: "openai/gpt-5.4-nano",
    short: "GPT-5.4 Nano",
    tier: "RAW_ONLY",
    inputCost: 0.2,
    outputCost: 1.25,
    contextWindow: 400000,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["raw_pin"],
    laneTags: ["raw"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gpt54Mini: createModelEntry("gpt54Mini", {
    id: "openai/gpt-5.4-mini",
    short: "GPT-5.4 Mini",
    tier: "MID_PREMIUM",
    inputCost: 0.75,
    outputCost: 4.5,
    contextWindow: 400000,
    modalities: ["text"],
    activeDefault: true,
    roleTags: ["strict_json_repair", "verifier", "midrange_control"],
    laneTags: ["strict-json", "control", "safe"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gpt54: createModelEntry("gpt54", {
    id: "openai/gpt-5.4",
    short: "GPT-5.4",
    tier: "PREMIUM",
    inputCost: 2.5,
    outputCost: 15,
    contextWindow: 400000,
    modalities: ["text"],
    activeDefault: true,
    roleTags: ["cross_family_verifier", "premium_executor"],
    laneTags: ["strict-json", "safe", "research"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  o4Mini: createModelEntry("o4Mini", {
    id: "openai/o4-mini",
    short: "o4-mini",
    tier: "RAW_ONLY",
    inputCost: 1.1,
    outputCost: 4.4,
    contextWindow: 200000,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["raw_pin"],
    laneTags: ["raw"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  o3: createModelEntry("o3", {
    id: "openai/o3",
    short: "o3",
    tier: "RAW_ONLY",
    inputCost: 2,
    outputCost: 8,
    contextWindow: 200000,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["raw_pin"],
    laneTags: ["raw"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  m27: createModelEntry("m27", {
    id: "minimax/minimax-m2.7",
    short: "MiniMax M2.7",
    tier: "WORKHORSE",
    inputCost: 0.3,
    outputCost: 1.2,
    contextWindow: 204800,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["workhorse", "coding", "planning", "orchestration", "core_loop"],
    laneTags: ["auto", "coding", "research"],
    supportsReasoningPreservation: true,
    supportedParameters: [
      "frequency_penalty",
      "include_reasoning",
      "logit_bias",
      "max_tokens",
      "min_p",
      "presence_penalty",
      "reasoning",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ]
  }),
  m25: createModelEntry("m25", {
    id: "minimax/minimax-m2.5",
    short: "MiniMax M2.5",
    tier: "BUDGET_WORKHORSE",
    inputCost: 0.2,
    outputCost: 1.17,
    contextWindow: 196608,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["strict_budget", "overflow", "family_fallback"],
    laneTags: ["cheap", "fallback"],
    supportsReasoningPreservation: true,
    supportedParameters: [
      "frequency_penalty",
      "include_reasoning",
      "logit_bias",
      "logprobs",
      "max_tokens",
      "min_p",
      "parallel_tool_calls",
      "presence_penalty",
      "reasoning",
      "reasoning_effort",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_logprobs",
      "top_p"
    ]
  }),
  kimiK25: createModelEntry("kimiK25", {
    id: "moonshotai/kimi-k2.5",
    short: "Kimi K2.5",
    tier: "SPECIALIST",
    inputCost: 0.45,
    outputCost: 2.2,
    contextWindow: 262144,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["vision", "visual_coding", "multimodal_specialist"],
    laneTags: ["vision", "research"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  kimiThinking: createModelEntry("kimiThinking", {
    id: "moonshotai/kimi-k2-thinking",
    short: "Kimi K2 Thinking",
    tier: "SPECIALIST",
    inputCost: 0.47,
    outputCost: 2,
    contextWindow: 131072,
    modalities: ["text"],
    activeDefault: true,
    roleTags: ["deep_research", "long_horizon_synthesis", "open_reasoning"],
    laneTags: ["research", "auto"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  glm47Flash: createModelEntry("glm47Flash", {
    id: "z-ai/glm-4.7-flash",
    short: "GLM 4.7 Flash",
    tier: "SPECIALIST",
    inputCost: 0.06,
    outputCost: 0.4,
    contextWindow: 202752,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["strict_json", "tool_arguments", "schema_repair"],
    laneTags: ["strict-json", "control"],
    supportedParameters: [
      "frequency_penalty",
      "include_reasoning",
      "max_tokens",
      "min_p",
      "presence_penalty",
      "reasoning",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ]
  }),
  glm5: createModelEntry("glm5", {
    id: "z-ai/glm-5",
    short: "GLM 5",
    tier: "SPECIALIST",
    inputCost: 0.72,
    outputCost: 2.3,
    contextWindow: 80000,
    modalities: ["text"],
    activeDefault: true,
    roleTags: ["strict_json", "hard_schema", "tool_specialist", "system_design"],
    laneTags: ["strict-json", "coding"],
    supportedParameters: [
      "frequency_penalty",
      "include_reasoning",
      "logit_bias",
      "logprobs",
      "max_tokens",
      "min_p",
      "presence_penalty",
      "reasoning",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_logprobs",
      "top_p"
    ]
  }),
  grok: createModelEntry("grok", {
    id: "x-ai/grok-4.1-fast",
    short: "Grok 4.1 Fast",
    tier: "VALUE",
    inputCost: 0.2,
    outputCost: 0.5,
    contextWindow: 2000000,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["cheap_chat", "light_tools", "long_context_value"],
    laneTags: ["cheap", "control", "research"],
    supportedParameters: [
      "include_reasoning",
      "logprobs",
      "max_tokens",
      "reasoning",
      "response_format",
      "seed",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_logprobs",
      "top_p"
    ]
  }),
  grok420Beta: createModelEntry("grok420Beta", {
    id: "x-ai/grok-4.20-beta",
    short: "Grok 4.20 Beta",
    tier: "PREVIEW",
    inputCost: 2,
    outputCost: 6,
    contextWindow: 2000000,
    modalities: ["text"],
    preview: true,
    roleTags: ["premium_research_preview"],
    laneTags: ["research", "preview"],
    supportedParameters: [
      "include_reasoning",
      "logprobs",
      "max_tokens",
      "reasoning",
      "response_format",
      "seed",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_logprobs",
      "top_p"
    ]
  }),
  dsCoder: createModelEntry("dsCoder", {
    id: "deepseek/deepseek-v3.2",
    short: "DeepSeek V3.2",
    tier: "VALUE",
    inputCost: 0.26,
    outputCost: 0.38,
    contextWindow: 163840,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["cheap_text_fallback", "overflow"],
    laneTags: ["cheap", "coding"],
    supportedParameters: [
      "frequency_penalty",
      "include_reasoning",
      "logit_bias",
      "max_tokens",
      "presence_penalty",
      "reasoning",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  qwen35Flash: createModelEntry("qwen35Flash", {
    id: "qwen/qwen3.5-flash-02-23",
    short: "Qwen 3.5 Flash",
    tier: "VALUE",
    inputCost: 0.065,
    outputCost: 0.26,
    contextWindow: 1000000,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["cheap_generalist", "cheap_multimodal", "retrieval", "summarization"],
    laneTags: ["cheap", "vision"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "presence_penalty",
      "reasoning",
      "response_format",
      "seed",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  qwen35Plus: createModelEntry("qwen35Plus", {
    id: "qwen/qwen3.5-plus-02-15",
    short: "Qwen 3.5 Plus",
    tier: "SPECIALIST",
    inputCost: 0.26,
    outputCost: 1.56,
    contextWindow: 1000000,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["long_context_research", "multimodal_research", "document_synthesis"],
    laneTags: ["research", "vision", "auto"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "presence_penalty",
      "reasoning",
      "response_format",
      "seed",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  qwenCoderNext: createModelEntry("qwenCoderNext", {
    id: "qwen/qwen3-coder-next",
    short: "Qwen 3 Coder Next",
    tier: "VALUE",
    inputCost: 0.12,
    outputCost: 0.75,
    contextWindow: 262144,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["cheap_coding", "coding_specialist"],
    laneTags: ["coding", "cheap"],
    supportedParameters: [
      "frequency_penalty",
      "logit_bias",
      "max_tokens",
      "min_p",
      "presence_penalty",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ]
  }),
  qwenMaxThinking: createModelEntry("qwenMaxThinking", {
    id: "qwen/qwen3-max-thinking",
    short: "Qwen 3 Max Thinking",
    tier: "RAW_ONLY",
    inputCost: 0.78,
    outputCost: 3.9,
    contextWindow: 262144,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["raw_pin"],
    laneTags: ["raw"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gem25FlashLite: createModelEntry("gem25FlashLite", {
    id: "google/gemini-2.5-flash-lite",
    short: "Gemini 2.5 Flash Lite",
    tier: "VALUE",
    inputCost: 0.1,
    outputCost: 0.4,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["cheap_multimodal_ingest", "stable_google_fast"],
    laneTags: ["cheap", "vision"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  gem25Pro: createModelEntry("gem25Pro", {
    id: "google/gemini-2.5-pro",
    short: "Gemini 2.5 Pro",
    tier: "PREMIUM",
    inputCost: 1.25,
    outputCost: 10,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    multimodal: true,
    longContext: true,
    rawOnly: true,
    roleTags: ["premium_multimodal_stable"],
    laneTags: ["vision", "raw"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  gem31FlashLite: createModelEntry("gem31FlashLite", {
    id: "google/gemini-3.1-flash-lite-preview",
    short: "Gemini 3.1 Flash Lite Preview",
    tier: "PREVIEW",
    inputCost: 0.25,
    outputCost: 1.5,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    preview: true,
    multimodal: true,
    longContext: true,
    roleTags: ["preview_google_fast"],
    laneTags: ["vision", "preview"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  gem31Pro: createModelEntry("gem31Pro", {
    id: "google/gemini-3.1-pro-preview",
    short: "Gemini 3.1 Pro Preview",
    tier: "PREVIEW",
    inputCost: 2,
    outputCost: 12,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    preview: true,
    multimodal: true,
    longContext: true,
    roleTags: ["premium_multimodal_preview", "preview_research"],
    laneTags: ["vision", "research", "preview"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_p"
    ]
  }),
  sonnet: createModelEntry("sonnet", {
    id: "anthropic/claude-sonnet-4.6",
    short: "Claude Sonnet 4.6",
    tier: "SAFE",
    inputCost: 3,
    outputCost: 15,
    contextWindow: 200000,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    roleTags: ["safe_lane", "premium_escalation"],
    laneTags: ["safe", "coding", "research", "vision"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p",
      "verbosity"
    ]
  }),
  opus: createModelEntry("opus", {
    id: "anthropic/claude-opus-4.6",
    short: "Claude Opus 4.6",
    tier: "SAFE",
    inputCost: 5,
    outputCost: 25,
    contextWindow: 200000,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    roleTags: ["final_escalation", "safe_lane"],
    laneTags: ["safe", "coding", "research", "vision"],
    supportedParameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p",
      "verbosity"
    ]
  })
};

const MODEL_ALIASES = {
  nano: "gpt5Nano",
  mini: "gpt54Mini",
  gemFlash: "gem25FlashLite"
};

for (const [alias, key] of Object.entries(MODEL_ALIASES)) {
  if (RAW_MODEL_MANIFEST[key]) RAW_MODEL_MANIFEST[key].aliases.push(alias);
}

const VIRTUAL_MODEL_MANIFEST = {
  "astrolabe/auto": {
    id: "astrolabe/auto",
    lane: "auto",
    name: "Astrolabe Auto",
    description: "Default OpenClaw routing surface with m27-first stable routing."
  },
  "astrolabe/coding": {
    id: "astrolabe/coding",
    lane: "coding",
    name: "Astrolabe Coding",
    description: "Code editing, repo work, and execution loops."
  },
  "astrolabe/research": {
    id: "astrolabe/research",
    lane: "research",
    name: "Astrolabe Research",
    description: "Long-context synthesis, source-heavy research, and deep reasoning."
  },
  "astrolabe/vision": {
    id: "astrolabe/vision",
    lane: "vision",
    name: "Astrolabe Vision",
    description: "Visual coding, screenshots, multimodal documents, and image-grounded reasoning."
  },
  "astrolabe/strict-json": {
    id: "astrolabe/strict-json",
    lane: "strict-json",
    name: "Astrolabe Strict JSON",
    description: "Structured outputs, schema-safe tool calls, and JSON repair."
  },
  "astrolabe/cheap": {
    id: "astrolabe/cheap",
    lane: "cheap",
    name: "Astrolabe Cheap",
    description: "Maximum useful work per dollar for low-risk turns."
  },
  "astrolabe/safe": {
    id: "astrolabe/safe",
    lane: "safe",
    name: "Astrolabe Safe",
    description: "High-stakes and approval-required routes with conservative premium models."
  }
};

const LANE_MANIFEST = {
  auto: {
    id: "lane_auto",
    description: "m27-first default lane for normal OpenClaw work.",
    defaultCandidates: ["m27", "qwen35Plus", "kimiThinking", "kimiK25", "sonnet", "opus"],
    fallbackCandidates: ["grok", "m25", "dsCoder", "qwen35Flash"]
  },
  coding: {
    id: "lane_coding",
    description: "Code editing, repo work, patching, and debug loops.",
    defaultCandidates: ["m27", "qwenCoderNext", "glm5", "sonnet", "opus"],
    fallbackCandidates: ["dsCoder", "m25"]
  },
  research: {
    id: "lane_research",
    description: "Long-context synthesis, comparative analysis, and source-heavy research.",
    defaultCandidates: ["qwen35Plus", "kimiThinking", "m27", "grok420Beta", "sonnet", "opus"],
    fallbackCandidates: ["gem31Pro", "gpt54"]
  },
  vision: {
    id: "lane_vision",
    description: "Multimodal, screenshots, documents, and image-grounded tasks.",
    defaultCandidates: ["kimiK25", "qwen35Plus", "gem25Pro", "gem31Pro", "sonnet"],
    fallbackCandidates: ["gem25FlashLite", "grok"]
  },
  "strict-json": {
    id: "lane_strict_json",
    description: "Structured output, tool arguments, and schema-sensitive work.",
    defaultCandidates: ["glm47Flash", "glm5", "gpt54Mini", "gpt54", "sonnet"],
    fallbackCandidates: ["m27", "m25"]
  },
  cheap: {
    id: "lane_cheap",
    description: "Low-risk, high-efficiency routing for simple and budget-sensitive turns.",
    defaultCandidates: ["qwen35Flash", "grok", "m25", "dsCoder", "gpt5Nano"],
    fallbackCandidates: ["gem25FlashLite", "m27"]
  },
  safe: {
    id: "lane_safe",
    description: "High-stakes lane with conservative premium defaults.",
    defaultCandidates: ["sonnet", "opus", "gpt54"],
    fallbackCandidates: ["m27"]
  }
};

const MODEL_FALLBACKS = {
  gpt5Nano: ["glm47Flash", "grok"],
  gpt54Nano: ["gpt5Nano", "gpt54Mini"],
  gpt54Mini: ["gpt54", "sonnet"],
  gpt54: ["sonnet", "opus"],
  o4Mini: ["gpt54Mini", "gpt54"],
  o3: ["gpt54", "sonnet"],
  m27: ["m25", "dsCoder", "sonnet"],
  m25: ["m27", "dsCoder", "grok"],
  kimiK25: ["qwen35Plus", "gem25Pro", "sonnet"],
  kimiThinking: ["qwen35Plus", "m27", "sonnet"],
  glm47Flash: ["glm5", "gpt54Mini", "sonnet"],
  glm5: ["gpt54Mini", "sonnet", "opus"],
  grok: ["qwen35Flash", "m25", "dsCoder"],
  grok420Beta: ["qwen35Plus", "sonnet"],
  dsCoder: ["qwenCoderNext", "m25", "m27"],
  qwen35Flash: ["grok", "m25", "gem25FlashLite"],
  qwen35Plus: ["kimiThinking", "m27", "sonnet"],
  qwenCoderNext: ["m27", "glm5", "sonnet"],
  qwenMaxThinking: ["qwen35Plus", "sonnet"],
  gem25FlashLite: ["qwen35Flash", "kimiK25", "gem25Pro"],
  gem25Pro: ["gem31Pro", "sonnet"],
  gem31FlashLite: ["gem25FlashLite", "qwen35Flash"],
  gem31Pro: ["gem25Pro", "sonnet"],
  sonnet: ["opus"],
  opus: []
};

const ESCALATION_PATH = {
  gpt5Nano: "glm47Flash",
  gpt54Nano: "gpt5Nano",
  gpt54Mini: "gpt54",
  gpt54: "sonnet",
  m25: "m27",
  dsCoder: "m27",
  qwenCoderNext: "m27",
  qwen35Flash: "grok",
  grok: "m25",
  glm47Flash: "glm5",
  glm5: "sonnet",
  m27: "sonnet",
  kimiK25: "sonnet",
  kimiThinking: "sonnet",
  qwen35Plus: "sonnet",
  gem25Pro: "sonnet",
  gem31Pro: "sonnet",
  sonnet: "opus"
};

const pricePer1M = Object.fromEntries(
  Object.values(RAW_MODEL_MANIFEST).map((model) => [
    model.id,
    {
      input: model.inputCost,
      output: model.outputCost
    }
  ])
);

function resolveModelAlias(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (RAW_MODEL_MANIFEST[raw]) return raw;
  if (MODEL_ALIASES[raw]) return MODEL_ALIASES[raw];
  return raw;
}

function resolveModelKeyFromId(modelId) {
  const normalized = String(modelId || "").trim().replace(/:exacto$/, "");
  if (!normalized) return null;
  for (const [key, model] of Object.entries(RAW_MODEL_MANIFEST)) {
    if (model.id === normalized) return key;
  }
  return null;
}

function modelEntryForKey(key) {
  return RAW_MODEL_MANIFEST[resolveModelAlias(key)] || null;
}

function modelIdForKey(key) {
  return modelEntryForKey(key)?.id || null;
}

function modelShortForKey(key) {
  return modelEntryForKey(key)?.short || null;
}

function rawModelsList() {
  return Object.values(RAW_MODEL_MANIFEST);
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
  MODEL_FALLBACKS,
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

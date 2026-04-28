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
    experimental: false,
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
    tier: "DEPRECATED",
    inputCost: 0.05,
    outputCost: 0.4,
    contextWindow: 400000,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gpt54Nano: createModelEntry("gpt54Nano", {
    id: "openai/gpt-5.4-nano",
    short: "GPT-5.4 Nano",
    tier: "CONTROL",
    inputCost: 0.2,
    outputCost: 1.25,
    contextWindow: 1050000,
    modalities: ["text", "image", "file"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["router", "classifier", "lightweight_verifier", "cheap_schema"],
    laneTags: ["control", "strict-json", "cheap"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gpt54Mini: createModelEntry("gpt54Mini", {
    id: "openai/gpt-5.4-mini",
    short: "GPT-5.4 Mini",
    tier: "MID_PREMIUM",
    inputCost: 0.75,
    outputCost: 4.5,
    contextWindow: 1050000,
    modalities: ["text", "image", "file"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
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
    contextWindow: 1050000,
    modalities: ["text", "image", "file"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["cross_family_verifier", "premium_executor", "safe_lane"],
    laneTags: ["safe", "research"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  gpt55: createModelEntry("gpt55", {
    id: "openai/gpt-5.5",
    short: "GPT-5.5",
    tier: "FRONTIER",
    inputCost: 5,
    outputCost: 30,
    contextWindow: 1050000,
    modalities: ["text", "image", "file"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["frontier_escalation", "premium_verifier", "safe_lane"],
    laneTags: ["safe", "research"],
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
    tier: "DEPRECATED",
    inputCost: 0.2,
    outputCost: 1.17,
    contextWindow: 196608,
    modalities: ["text"],
    rawOnly: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
    tier: "DEPRECATED",
    inputCost: 0.45,
    outputCost: 2.2,
    contextWindow: 262144,
    modalities: ["text", "image"],
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  kimiThinking: createModelEntry("kimiThinking", {
    id: "moonshotai/kimi-k2-thinking",
    short: "Kimi K2 Thinking",
    tier: "DEPRECATED",
    inputCost: 0.47,
    outputCost: 2,
    contextWindow: 131072,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  kimiK26: createModelEntry("kimiK26", {
    id: "moonshotai/kimi-k2.6",
    short: "Kimi K2.6",
    tier: "SPECIALIST",
    inputCost: 0.7448,
    outputCost: 4.655,
    contextWindow: 256000,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["vision", "visual_coding", "multimodal_specialist", "coding"],
    laneTags: ["vision", "coding", "auto"],
    supportedParameters: ["include_reasoning", "max_tokens", "reasoning", "response_format", "seed", "structured_outputs", "tool_choice", "tools"]
  }),
  glm47Flash: createModelEntry("glm47Flash", {
    id: "z-ai/glm-4.7-flash",
    short: "GLM 4.7 Flash",
    tier: "RAW_ONLY",
    inputCost: 0.06,
    outputCost: 0.4,
    contextWindow: 202752,
    modalities: ["text"],
    rawOnly: true,
    longContext: true,
    roleTags: ["transition_fallback", "strict_json"],
    laneTags: ["raw", "deprecated", "strict-json"],
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
    tier: "DEPRECATED",
    inputCost: 0.72,
    outputCost: 2.3,
    contextWindow: 80000,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
  glm51: createModelEntry("glm51", {
    id: "z-ai/glm-5.1",
    short: "GLM 5.1",
    tier: "SPECIALIST",
    inputCost: 1.05,
    outputCost: 3.5,
    contextWindow: 202752,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["strict_json", "tool_specialist", "coding", "schema_repair"],
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
  grok420: createModelEntry("grok420", {
    id: "x-ai/grok-4.20",
    short: "Grok 4.20",
    tier: "PREMIUM",
    inputCost: 2,
    outputCost: 6,
    contextWindow: 2000000,
    modalities: ["text", "image", "file"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["premium_research", "long_context"],
    laneTags: ["research"],
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
  mimoV2Flash: createModelEntry("mimoV2Flash", {
    id: "xiaomi/mimo-v2-flash",
    short: "MiMo V2 Flash",
    tier: "RAW_ONLY",
    inputCost: 0.09,
    outputCost: 0.29,
    contextWindow: 262144,
    modalities: ["text"],
    rawOnly: true,
    roleTags: ["eval_candidate", "agentic_value"],
    laneTags: ["raw", "evaluation"],
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
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ]
  }),
  mimoV25Pro: createModelEntry("mimoV25Pro", {
    id: "xiaomi/mimo-v2.5-pro",
    short: "MiMo V2.5 Pro",
    tier: "SPECIALIST",
    inputCost: 1,
    outputCost: 3,
    contextWindow: 1048576,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["coding", "agentic", "long_context", "research"],
    laneTags: ["auto", "coding", "research"],
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
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ]
  }),
  mimoV25: createModelEntry("mimoV25", {
    id: "xiaomi/mimo-v2.5",
    short: "MiMo V2.5",
    tier: "PREVIEW",
    inputCost: 0.4,
    outputCost: 2,
    contextWindow: 1048576,
    modalities: ["text", "image", "audio", "video"],
    rawOnly: true,
    preview: true,
    experimental: true,
    multimodal: true,
    longContext: true,
    roleTags: ["eval_candidate", "multimodal_preview"],
    laneTags: ["vision", "experimental", "raw", "evaluation"],
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
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ]
  }),
  mistralSmall4: createModelEntry("mistralSmall4", {
    id: "mistralai/mistral-small-2603",
    short: "Mistral Small 4",
    tier: "VALUE",
    inputCost: 0.15,
    outputCost: 0.6,
    contextWindow: 262144,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["cheap_multimodal", "multimodal_utility", "fallback"],
    laneTags: ["cheap", "vision", "coding"],
    supportedParameters: [
      "frequency_penalty",
      "include_reasoning",
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
  dsCoder: createModelEntry("dsCoder", {
    id: "deepseek/deepseek-v3.2",
    short: "DeepSeek V3.2",
    tier: "DEPRECATED",
    inputCost: 0.26,
    outputCost: 0.38,
    contextWindow: 163840,
    modalities: ["text"],
    rawOnly: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
  deepseekV4Pro: createModelEntry("deepseekV4Pro", {
    id: "deepseek/deepseek-v4-pro",
    short: "DeepSeek V4 Pro",
    tier: "WORKHORSE",
    inputCost: 0.435,
    outputCost: 0.87,
    contextWindow: 1048576,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["coding", "agentic", "long_context", "workhorse_challenger"],
    laneTags: ["auto", "coding", "research"],
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
  deepseekV4Flash: createModelEntry("deepseekV4Flash", {
    id: "deepseek/deepseek-v4-flash",
    short: "DeepSeek V4 Flash",
    tier: "VALUE",
    inputCost: 0.14,
    outputCost: 0.28,
    contextWindow: 1048576,
    modalities: ["text"],
    activeDefault: true,
    longContext: true,
    roleTags: ["cheap_long_context", "coding_fallback", "schema_recovery"],
    laneTags: ["cheap", "coding", "strict-json"],
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
    tier: "DEPRECATED",
    inputCost: 0.065,
    outputCost: 0.26,
    contextWindow: 1000000,
    modalities: ["text", "image"],
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
    tier: "DEPRECATED",
    inputCost: 0.26,
    outputCost: 1.56,
    contextWindow: 1000000,
    modalities: ["text", "image"],
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
    tier: "DEPRECATED",
    inputCost: 0.12,
    outputCost: 0.75,
    contextWindow: 262144,
    modalities: ["text"],
    rawOnly: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
  qwen36Plus: createModelEntry("qwen36Plus", {
    id: "qwen/qwen3.6-plus",
    short: "Qwen 3.6 Plus",
    tier: "SPECIALIST",
    inputCost: 0.325,
    outputCost: 1.95,
    contextWindow: 1000000,
    modalities: ["text", "image", "video"],
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
    tier: "DEPRECATED",
    inputCost: 0.1,
    outputCost: 0.4,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
    tier: "DEPRECATED",
    inputCost: 1.25,
    outputCost: 10,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
  gemma431b: createModelEntry("gemma431b", {
    id: "google/gemma-4-31b-it",
    short: "Gemma 4 31B IT",
    tier: "VALUE",
    inputCost: 0.13,
    outputCost: 0.38,
    contextWindow: 262144,
    modalities: ["text", "image", "video"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["cheap_multimodal", "cheap_generalist", "summarization"],
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
  gem31FlashLite: createModelEntry("gem31FlashLite", {
    id: "google/gemini-3.1-flash-lite-preview",
    short: "Gemini 3.1 Flash Lite Preview",
    tier: "PREVIEW",
    inputCost: 0.25,
    outputCost: 1.5,
    contextWindow: 1048576,
    modalities: ["text", "image"],
    preview: true,
    experimental: true,
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["preview_google_fast"],
    laneTags: ["vision", "preview", "experimental", "raw"],
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
    experimental: true,
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["premium_multimodal_preview", "preview_research"],
    laneTags: ["vision", "research", "preview", "experimental", "raw"],
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
  gem31ProTools: createModelEntry("gem31ProTools", {
    id: "google/gemini-3.1-pro-preview-customtools",
    short: "Gemini 3.1 Pro Preview Custom Tools",
    tier: "PREVIEW",
    inputCost: 2,
    outputCost: 12,
    contextWindow: 1048576,
    modalities: ["text", "image", "file", "audio", "video"],
    preview: true,
    experimental: true,
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["premium_multimodal_preview", "tool_preview"],
    laneTags: ["vision", "research", "preview", "experimental", "raw"],
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
  glm5vTurbo: createModelEntry("glm5vTurbo", {
    id: "z-ai/glm-5v-turbo",
    short: "GLM 5V Turbo",
    tier: "PREVIEW",
    inputCost: 1.2,
    outputCost: 4,
    contextWindow: 202752,
    modalities: ["text", "image", "video"],
    preview: true,
    experimental: true,
    rawOnly: true,
    multimodal: true,
    longContext: true,
    roleTags: ["vision_preview", "visual_coding_eval"],
    laneTags: ["vision", "coding", "experimental", "raw"],
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
  sonnet: createModelEntry("sonnet", {
    id: "anthropic/claude-sonnet-4.6",
    short: "Claude Sonnet 4.6",
    tier: "SAFE",
    inputCost: 3,
    outputCost: 15,
    contextWindow: 1000000,
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
    tier: "DEPRECATED",
    inputCost: 5,
    outputCost: 25,
    contextWindow: 200000,
    modalities: ["text", "image"],
    rawOnly: true,
    multimodal: true,
    roleTags: ["deprecated", "raw_pin"],
    laneTags: ["raw", "deprecated"],
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
  opus47: createModelEntry("opus47", {
    id: "anthropic/claude-opus-4.7",
    short: "Claude Opus 4.7",
    tier: "SAFE",
    inputCost: 5,
    outputCost: 25,
    contextWindow: 1000000,
    modalities: ["text", "image"],
    activeDefault: true,
    multimodal: true,
    longContext: true,
    roleTags: ["final_escalation", "safe_lane"],
    laneTags: ["safe", "research"],
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
  nano: "gpt54Nano",
  mini: "gpt54Mini",
  gemFlash: "gem25FlashLite",
  grok41Fast: "grok",
  grok420Beta: "grok420"
};

for (const [alias, key] of Object.entries(MODEL_ALIASES)) {
  if (RAW_MODEL_MANIFEST[key]) RAW_MODEL_MANIFEST[key].aliases.push(alias);
}

const VIRTUAL_MODEL_MANIFEST = {
  "astrolabe/auto": {
    id: "astrolabe/auto",
    lane: "auto",
    name: "Astrolabe Auto",
    description: "Default OpenClaw routing surface with DeepSeek V4 Pro-first serious-work routing."
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
    description: "DeepSeek V4 Pro-first default lane for normal OpenClaw work.",
    defaultCandidates: ["deepseekV4Pro", "m27", "mimoV25Pro", "qwen36Plus", "kimiK26", "sonnet"],
    fallbackCandidates: ["grok", "gemma431b", "mistralSmall4"],
    experimentalCandidates: []
  },
  coding: {
    id: "lane_coding",
    description: "Code editing, repo work, patching, and debug loops.",
    defaultCandidates: ["deepseekV4Pro", "m27", "mimoV25Pro", "kimiK26", "glm51", "sonnet"],
    fallbackCandidates: ["deepseekV4Flash", "mistralSmall4", "grok"],
    experimentalCandidates: []
  },
  research: {
    id: "lane_research",
    description: "Long-context synthesis, comparative analysis, and source-heavy research.",
    defaultCandidates: ["qwen36Plus", "mimoV25Pro", "m27", "deepseekV4Pro", "grok420", "gpt54", "opus47", "gpt55"],
    fallbackCandidates: ["grok", "gemma431b"],
    experimentalCandidates: ["gem31Pro"]
  },
  vision: {
    id: "lane_vision",
    description: "Multimodal, screenshots, documents, and image-grounded tasks.",
    defaultCandidates: ["qwen36Plus", "kimiK26", "gemma431b", "mistralSmall4", "sonnet"],
    fallbackCandidates: [],
    experimentalCandidates: ["gem31Pro", "gem31ProTools", "mimoV25", "glm5vTurbo"]
  },
  "strict-json": {
    id: "lane_strict_json",
    description: "GPT-5.4 Nano-first structured output lane with specialist recovery after concrete validation failure.",
    defaultCandidates: ["gpt54Nano", "glm51", "deepseekV4Flash", "m27", "gpt54Mini", "sonnet"],
    fallbackCandidates: ["glm47Flash"],
    experimentalCandidates: []
  },
  cheap: {
    id: "lane_cheap",
    description: "Low-risk, high-efficiency routing for simple and budget-sensitive turns.",
    defaultCandidates: ["gemma431b", "deepseekV4Flash", "grok", "mistralSmall4", "gpt54Nano"],
    fallbackCandidates: [],
    experimentalCandidates: []
  },
  safe: {
    id: "lane_safe",
    description: "High-stakes lane with conservative premium defaults.",
    defaultCandidates: ["sonnet", "opus47", "gpt55", "gpt54"],
    fallbackCandidates: ["m27"],
    experimentalCandidates: []
  }
};

const MODEL_FALLBACKS = {
  gpt5Nano: ["gpt54Nano", "deepseekV4Flash", "m27"],
  gpt54Nano: ["glm51", "deepseekV4Flash", "m27"],
  gpt54Mini: ["gpt54", "sonnet"],
  gpt54: ["gpt55", "sonnet"],
  gpt55: [],
  o4Mini: ["gpt54Mini", "gpt54"],
  o3: ["gpt54", "sonnet"],
  m27: ["deepseekV4Pro", "sonnet"],
  m25: ["m27", "deepseekV4Flash", "grok"],
  kimiK25: ["kimiK26", "qwen36Plus", "sonnet"],
  kimiThinking: ["qwen36Plus", "m27", "sonnet"],
  kimiK26: ["qwen36Plus", "sonnet"],
  glm47Flash: ["glm51", "deepseekV4Flash", "gpt54Mini", "sonnet"],
  glm5: ["glm51", "gpt54Mini", "sonnet"],
  glm51: ["deepseekV4Flash", "gpt54Mini", "sonnet"],
  grok: ["gemma431b", "m27"],
  grok420: ["qwen36Plus", "gpt54", "sonnet"],
  mimoV25Pro: ["deepseekV4Pro", "m27", "sonnet"],
  mimoV25: ["qwen36Plus", "kimiK26", "sonnet"],
  mistralSmall4: ["gemma431b", "grok", "m27"],
  dsCoder: ["deepseekV4Flash", "m27", "glm51"],
  deepseekV4Pro: ["m27", "mimoV25Pro", "sonnet"],
  deepseekV4Flash: ["gemma431b", "grok", "m27"],
  qwen35Flash: ["gemma431b", "grok", "deepseekV4Flash"],
  qwen35Plus: ["qwen36Plus", "m27", "sonnet"],
  qwenCoderNext: ["deepseekV4Flash", "m27", "glm51"],
  qwen36Plus: ["mimoV25Pro", "sonnet"],
  qwenMaxThinking: ["qwen36Plus", "sonnet"],
  gem25FlashLite: ["gemma431b", "deepseekV4Flash", "mistralSmall4"],
  gem25Pro: ["qwen36Plus", "sonnet"],
  gemma431b: ["deepseekV4Flash", "grok", "m27"],
  gem31FlashLite: ["gem25FlashLite", "qwen35Flash"],
  gem31Pro: ["qwen36Plus", "sonnet"],
  gem31ProTools: ["gem31Pro", "sonnet"],
  glm5vTurbo: ["qwen36Plus", "kimiK26", "sonnet"],
  sonnet: ["opus47", "gpt55"],
  opus: ["opus47", "gpt55"],
  opus47: ["gpt55"]
};

const ESCALATION_PATH = {
  gpt5Nano: "gpt54Nano",
  gpt54Nano: "glm51",
  gpt54Mini: "gpt54",
  gpt54: "gpt55",
  m25: "m27",
  dsCoder: "deepseekV4Flash",
  qwenCoderNext: "deepseekV4Flash",
  qwen35Flash: "gemma431b",
  grok: "m25",
  glm47Flash: "glm51",
  glm5: "glm51",
  glm51: "deepseekV4Flash",
  deepseekV4Flash: "m27",
  deepseekV4Pro: "m27",
  m27: "deepseekV4Pro",
  mimoV25Pro: "sonnet",
  kimiK25: "kimiK26",
  kimiThinking: "qwen36Plus",
  kimiK26: "sonnet",
  qwen35Plus: "qwen36Plus",
  qwen36Plus: "sonnet",
  gem25Pro: "qwen36Plus",
  gemma431b: "deepseekV4Flash",
  mistralSmall4: "gemma431b",
  gem31Pro: "sonnet",
  sonnet: "opus47",
  opus47: "gpt55"
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

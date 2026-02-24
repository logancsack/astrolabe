/*
  Astrolabe beta: headless OpenAI-compatible cost router for OpenClaw.

  Core objective:
  Route each request to the cheapest model that is still likely to be correct,
  while adding explicit safety gates for high-stakes requests.
*/

const crypto = require("crypto");
const express = require("express");
const axios = require("axios");
require("dotenv").config();

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const ASTROLABE_API_KEY = (process.env.ASTROLABE_API_KEY || "").trim();
const PORT = Number(process.env.PORT) || 3000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const ROUTING_PROFILE = normalizeRoutingProfile(
  String(process.env.ASTROLABE_ROUTING_PROFILE || "budget")
    .trim()
    .toLowerCase()
);
const COST_EFFICIENCY_MODE = normalizeCostMode(
  String(process.env.ASTROLABE_COST_EFFICIENCY_MODE || "strict")
    .trim()
    .toLowerCase()
);
const ALLOW_DIRECT_PREMIUM_MODELS = envFlag("ASTROLABE_ALLOW_DIRECT_PREMIUM_MODELS", false);
const ENABLE_SAFETY_GATE = envFlag("ASTROLABE_ENABLE_SAFETY_GATE", true);
const HIGH_STAKES_CONFIRM_MODE = normalizeHighStakesConfirmMode(
  String(process.env.ASTROLABE_HIGH_STAKES_CONFIRM_MODE || "prompt")
    .trim()
    .toLowerCase()
);
const HIGH_STAKES_CONFIRM_TOKEN =
  String(process.env.ASTROLABE_HIGH_STAKES_CONFIRM_TOKEN || "confirm")
    .trim()
    .toLowerCase() || "confirm";
const ALLOW_HIGH_STAKES_BUDGET_FLOOR = envFlag("ASTROLABE_ALLOW_HIGH_STAKES_BUDGET_FLOOR", false);
const FORCE_MODEL_ID = (process.env.ASTROLABE_FORCE_MODEL || "").trim();
const CLASSIFIER_MODEL_KEY = String(process.env.ASTROLABE_CLASSIFIER_MODEL_KEY || "nano")
  .trim()
  .toLowerCase();
const SELF_CHECK_MODEL_KEY = String(process.env.ASTROLABE_SELF_CHECK_MODEL_KEY || "nano")
  .trim()
  .toLowerCase();
const CLASSIFIER_CONTEXT_MESSAGES = clampInt(process.env.ASTROLABE_CONTEXT_MESSAGES, 8, 3, 20);
const CLASSIFIER_CONTEXT_CHARS = clampInt(process.env.ASTROLABE_CONTEXT_CHARS, 2500, 600, 12000);

const MODELS = {
  opus: {
    id: "anthropic/claude-opus-4.6",
    short: "Opus 4.6",
    inputCost: 15,
    outputCost: 75,
    tier: "PREMIUM"
  },
  sonnet: {
    id: "anthropic/claude-sonnet-4.6",
    short: "Sonnet 4.6",
    inputCost: 3,
    outputCost: 15,
    tier: "STANDARD"
  },
  kimiK25: {
    id: "moonshotai/kimi-k2.5",
    short: "Kimi K2.5",
    inputCost: 0.45,
    outputCost: 2.2,
    tier: "VALUE"
  },
  glm5: {
    id: "z-ai/glm-5",
    short: "GLM 5",
    inputCost: 0.95,
    outputCost: 2.55,
    tier: "VALUE"
  },
  grok: {
    id: "x-ai/grok-4.1-fast",
    short: "Grok 4.1 Fast",
    inputCost: 0.2,
    outputCost: 0.5,
    tier: "BUDGET"
  },
  nano: {
    id: "openai/gpt-5-nano",
    short: "GPT-5 Nano",
    inputCost: 0.05,
    outputCost: 0.4,
    tier: "ULTRA-CHEAP"
  },
  dsCoder: {
    id: "deepseek/deepseek-v3.2-coder",
    short: "DS V3.2 Coder",
    inputCost: 0.1,
    outputCost: 0.3,
    tier: "ULTRA-CHEAP"
  },
  gemFlash: {
    id: "google/gemini-3-flash",
    short: "Gemini 3 Flash",
    inputCost: 0.05,
    outputCost: 0.2,
    tier: "ULTRA-CHEAP"
  },
  gem31Pro: {
    id: "google/gemini-3.1-pro-preview",
    short: "Gemini 3.1 Pro",
    inputCost: 2,
    outputCost: 12,
    tier: "MID-TIER"
  }
};

const pricePer1M = Object.fromEntries(
  Object.values(MODELS).map((model) => [model.id, { input: model.inputCost, output: model.outputCost }])
);

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
  nano: ["gemFlash", "grok", "kimiK25", "glm5", "sonnet"],
  dsCoder: ["gemFlash", "grok", "glm5", "kimiK25", "sonnet"],
  gemFlash: ["nano", "grok", "kimiK25", "glm5", "sonnet"],
  grok: ["gemFlash", "nano", "kimiK25", "glm5", "sonnet"],
  gem31Pro: ["glm5", "kimiK25", "sonnet", "grok", "opus"],
  kimiK25: ["glm5", "sonnet", "gem31Pro", "grok", "opus"],
  glm5: ["kimiK25", "sonnet", "gem31Pro", "grok", "opus"],
  sonnet: ["glm5", "kimiK25", "grok", "gem31Pro", "opus"],
  opus: ["sonnet", "glm5", "kimiK25"]
};

const ESCALATION_PATH = {
  nano: "grok",
  dsCoder: "glm5",
  gemFlash: "grok",
  grok: "kimiK25",
  gem31Pro: "glm5",
  kimiK25: "sonnet",
  glm5: "sonnet",
  sonnet: "opus",
  opus: null
};

const HIGH_STAKES_ACTION_REGEX = /\b(transfer|wire|send money|payment|pay|purchase|buy|sell|contract sign|approve|delete|erase|reset password|share pii|submit legal)\b/i;
const HIGH_STAKES_SYNONYMS = [
  "social security",
  "ssn",
  "bank account",
  "routing number",
  "medical record",
  "health data",
  "passport",
  "driver license",
  "tax return"
];
const HIGH_STAKES_WEAK_SIGNALS = new Set(["invoice", "contract", "legal", "health", "sensitive"]);

const ONBOARDING_CHAT_REGEX = /\b(name|call me|my name is|nickname|introduce|introduction|setup|set up|persona|profile|roleplay|character|identity|who are you)\b/i;
const CASUAL_CHAT_REGEX = /\b(hello|hi|hey|thanks|thank you|good morning|good evening|nice to meet|how are you)\b/i;

const HIGH_STAKES_POLICY_PROMPT = [
  "[ASTROLABE_HIGH_STAKES_POLICY]",
  "This request is classified as high-stakes.",
  "If the user is asking for an irreversible action, request explicit confirmation before completing it.",
  "For legal, financial, health, or sensitive topics, be precise, conservative, and clearly state uncertainty."
].join(" ");

const CLASSIFIER_PROMPT = [
  "You are Astrolabe's strict routing classifier.",
  "Return strict JSON only with keys: category, complexity, confidence, reason, matched_signals, high_stakes.",
  'Allowed category values: "heartbeat","core_loop","retrieval","summarization","planning","orchestration","coding","research","creative","communication","high_stakes","reflection".',
  'Allowed complexity values: "simple","standard","complex","critical".',
  "confidence must be an integer 1-5.",
  "matched_signals must be an array of short strings.",
  "Set high_stakes=true only for sensitive personal data, financial/legal actions, password/PII handling, or irreversible operations.",
  "Do not mark high_stakes for generic discussion, brainstorming, or educational talk about legal or health topics.",
  "Choose the cheapest safe route target: avoid over-routing to expensive categories unless justified.",
  "For onboarding chat, naming, introductions, persona setup, or casual social conversation, prefer communication/simple.",
  "Do not choose core_loop unless there are explicit tool-use, function-call, or orchestration signals.",
  "Complexity rubric:",
  "- simple: short routine request with low ambiguity",
  "- standard: moderate context, normal reasoning",
  "- complex: long context, multi-constraint, heavy reasoning or multimodal",
  "- critical: irreversible, safety-sensitive, or mission-critical",
  "No markdown. No extra text."
].join("\n");

const SELF_CHECK_PROMPT = [
  "You are Astrolabe's strict answer quality checker.",
  "Judge whether the assistant answer is complete, correct, and safe for the user request.",
  "Return strict JSON only with keys: score, reason.",
  "score must be integer 1-5 where 5 is very confident.",
  "No markdown. No extra text."
].join("\n");

const app = express();
app.use(express.json({ limit: "4mb" }));

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function normalizeCostMode(mode) {
  if (mode === "off") return "off";
  if (mode === "balanced") return "balanced";
  return "strict";
}

function normalizeRoutingProfile(profile) {
  if (profile === "quality") return "quality";
  if (profile === "balanced") return "balanced";
  return "budget";
}

function normalizeHighStakesConfirmMode(mode) {
  if (mode === "off") return "off";
  if (mode === "strict") return "strict";
  return "prompt";
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function extractInboundApiKey(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return String(req.headers["x-api-key"] || "").trim();
}

app.use((req, res, next) => {
  if (!ASTROLABE_API_KEY) return next();
  const inboundKey = extractInboundApiKey(req);
  if (inboundKey === ASTROLABE_API_KEY) return next();
  return res.status(401).json({
    error: {
      message: "Unauthorized. Missing or invalid API key.",
      type: "authentication_error",
      code: "invalid_api_key"
    }
  });
});

function safeText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (typeof item.text === "string") return item.text;
        if (item.type === "text" && typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function modelIdForKey(modelKey) {
  return MODELS[modelKey]?.id || null;
}

function modelShortForKey(modelKey) {
  return MODELS[modelKey]?.short || modelKey || "custom";
}

function extractLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === "user") {
      const text = safeText(msg.content).trim();
      if (text) return text;
    }
  }
  return "";
}

function buildRecentContext(messages, maxMessages = CLASSIFIER_CONTEXT_MESSAGES, maxChars = CLASSIFIER_CONTEXT_CHARS) {
  const recent = messages.slice(-maxMessages);
  const packed = recent
    .map((msg) => {
      const role = msg?.role || "unknown";
      const text = normalizeWhitespace(safeText(msg?.content)).slice(0, 320);
      return `${role}: ${text}`;
    })
    .join("\n");
  return packed.slice(0, maxChars);
}

function extractConversationFeatures(messages, body) {
  const stats = {
    messageCount: Array.isArray(messages) ? messages.length : 0,
    userMessages: 0,
    systemMessages: 0,
    assistantMessages: 0,
    toolMessages: 0,
    hasMultimodal: false,
    hasToolsDeclared: Array.isArray(body?.tools) && body.tools.length > 0,
    approxChars: 0,
    approxTokens: 0
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "user") stats.userMessages += 1;
    if (msg.role === "assistant") stats.assistantMessages += 1;
    if (msg.role === "system") stats.systemMessages += 1;
    if (msg.role === "tool") stats.toolMessages += 1;

    const content = msg.content;
    const text = safeText(content);
    stats.approxChars += text.length;

    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (part.type && part.type !== "text") stats.hasMultimodal = true;
      }
    }
  }

  stats.approxTokens = Math.ceil(stats.approxChars / 4);
  return stats;
}

function normalizeCategoryId(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[ -]/g, "_");
  if (CATEGORY_BY_ID.has(value)) return value;
  return null;
}

function normalizeComplexity(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (COMPLEXITY_ORDER.includes(value)) return value;
  if (value === "routine" || value === "low") return "simple";
  if (value === "medium" || value === "moderate") return "standard";
  if (value === "hard" || value === "high") return "complex";
  return null;
}

function parseScore(value, fallback = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(5, Math.round(num)));
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function signalToRegex(signal) {
  const normalized = String(signal || "").trim().toLowerCase().replace(/_/g, "[\\s_-]*");
  return new RegExp(`\\b${normalized}\\b`, "i");
}

function collectMatchedSignals(text, signals) {
  const normalizedText = String(text || "").toLowerCase();
  const matched = [];
  for (const signal of signals) {
    const regex = signalToRegex(signal);
    if (regex.test(normalizedText)) matched.push(signal);
  }
  return dedupe(matched);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractFirstJsonObject(rawText) {
  const text = String(rawText || "");
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseClassifierOutput(raw) {
  const direct = tryParseJson(raw);
  const embedded = direct || tryParseJson(extractFirstJsonObject(raw) || "");
  const object = embedded && typeof embedded === "object" ? embedded : null;

  if (object) {
    const categoryId = normalizeCategoryId(object.category);
    const complexity = normalizeComplexity(object.complexity);
    if (categoryId && complexity) {
      return {
        categoryId,
        complexity,
        confidence: parseScore(object.confidence, 3),
        reason: normalizeWhitespace(object.reason || "Model classifier."),
        matchedSignals: Array.isArray(object.matched_signals)
          ? dedupe(object.matched_signals.map((signal) => String(signal).slice(0, 48).toLowerCase()))
          : [],
        highStakes: Boolean(object.high_stakes)
      };
    }
  }

  const fallbackCategoryMatch = String(raw || "").match(
    /\b(heartbeat|core_loop|retrieval|summarization|planning|orchestration|coding|research|creative|communication|high_stakes|reflection)\b/i
  );
  const fallbackComplexityMatch = String(raw || "").match(/\b(simple|standard|complex|critical)\b/i);
  if (fallbackCategoryMatch && fallbackComplexityMatch) {
    const categoryId = normalizeCategoryId(fallbackCategoryMatch[1]);
    const complexity = normalizeComplexity(fallbackComplexityMatch[1]);
    if (categoryId && complexity) {
      return {
        categoryId,
        complexity,
        confidence: 3,
        reason: "Classifier parsed from loose text.",
        matchedSignals: [],
        highStakes: categoryId === "high_stakes"
      };
    }
  }

  return null;
}

function parseSelfCheckOutput(raw) {
  const direct = tryParseJson(raw);
  const embedded = direct || tryParseJson(extractFirstJsonObject(raw) || "");
  const object = embedded && typeof embedded === "object" ? embedded : null;

  if (object) {
    return {
      score: parseScore(object.score, 4),
      reason: normalizeWhitespace(object.reason || "Self-check scored by model.")
    };
  }

  const loose = String(raw || "").match(/\b([1-5])\b\s*[:|-]?\s*(.{0,180})/);
  if (loose) {
    return {
      score: parseScore(loose[1], 4),
      reason: normalizeWhitespace(loose[2] || "Self-check parsed from loose text.")
    };
  }

  return { score: 4, reason: "Self-check parse fallback (score=4)." };
}

function riskRank(risk) {
  if (risk === "CRITICAL") return 5;
  if (risk === "HIGH") return 4;
  if (risk === "MEDIUM-HIGH") return 3;
  if (risk === "MEDIUM") return 2;
  return 1;
}

function shiftComplexity(complexity, delta) {
  const index = COMPLEXITY_ORDER.indexOf(complexity);
  if (index < 0) return complexity;
  const next = Math.max(0, Math.min(COMPLEXITY_ORDER.length - 1, index + delta));
  return COMPLEXITY_ORDER[next];
}

function applyRoutingProfile(complexity, categoryId) {
  if (!COMPLEXITY_ORDER.includes(complexity)) return "standard";
  if (ROUTING_PROFILE === "quality") return shiftComplexity(complexity, 1);
  if (ROUTING_PROFILE === "budget") {
    const category = CATEGORY_BY_ID.get(categoryId);
    if (!category) return complexity;
    if (riskRank(category.injectionRisk) >= 3) return complexity;
    return shiftComplexity(complexity, -1);
  }
  return complexity;
}

function detectSafetyGate(text) {
  if (!ENABLE_SAFETY_GATE) {
    return { triggered: false, matchedSignals: [], actionLike: false };
  }

  const categorySignals = CATEGORY_BY_ID.get("high_stakes")?.classifierSignals || [];
  const baseMatches = collectMatchedSignals(text, categorySignals);
  const synonymMatches = HIGH_STAKES_SYNONYMS.filter((signal) =>
    new RegExp(`\\b${escapeRegex(signal)}\\b`, "i").test(text)
  );
  const actionLike = HIGH_STAKES_ACTION_REGEX.test(text);
  const strongMatches = baseMatches.filter((signal) => !HIGH_STAKES_WEAK_SIGNALS.has(signal));
  const weakMatches = baseMatches.filter((signal) => HIGH_STAKES_WEAK_SIGNALS.has(signal));
  const matchedSignals = dedupe([...baseMatches, ...synonymMatches]);
  const weakOnlyTriggered = weakMatches.length >= 2;

  return {
    triggered: actionLike || synonymMatches.length > 0 || strongMatches.length > 0 || weakOnlyTriggered,
    matchedSignals,
    actionLike
  };
}

function scoreCategoriesWithSignals(text) {
  const scores = [];
  for (const category of CATEGORY_POLICIES) {
    if (category.id === "high_stakes") continue;
    const matched = collectMatchedSignals(text, category.classifierSignals);
    scores.push({
      id: category.id,
      score: matched.length,
      matchedSignals: matched
    });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function isOnboardingLikeRequest(text) {
  const normalized = normalizeWhitespace(text);
  return ONBOARDING_CHAT_REGEX.test(normalized) || CASUAL_CHAT_REGEX.test(normalized);
}

function heuristicCategoryFallback(text, features = {}) {
  const hasTools = Boolean(features.hasToolsDeclared) || Number(features.toolMessages || 0) > 0;
  if (hasTools) return "core_loop";
  if (/\b(code|debug|refactor|test|function|script|stack trace|exception)\b/i.test(text)) return "coding";
  if (/\b(summarize|summary|extract|action items|digest|invoice|receipt)\b/i.test(text)) return "summarization";
  if (/\b(plan|roadmap|schedule|itinerary|steps|break down)\b/i.test(text)) return "planning";
  if (/\b(web|search|lookup|find|calendar|email|weather|stock)\b/i.test(text)) return "retrieval";
  if (/\b(research|analysis|compare|literature|report|due diligence)\b/i.test(text)) return "research";
  if (/\b(creative|story|poem|brainstorm|copywriting|campaign)\b/i.test(text)) return "creative";
  if (/\b(reply|message|chat|customer support|email response|negotiat)\b/i.test(text)) return "communication";
  if (/\b(browser|automation|shell|git|workflow|pipeline|checkout)\b/i.test(text)) return "orchestration";
  if (/\b(reflect|stuck|loop|failure analysis|improve)\b/i.test(text)) return "reflection";
  if (/\b(heartbeat|ping|status|health check|keep-alive)\b/i.test(text)) return "heartbeat";
  if (isOnboardingLikeRequest(text)) return "communication";
  return "communication";
}

function heuristicComplexity(text, features, categoryId, safetyGate) {
  const normalized = normalizeWhitespace(text);
  const hasTools = Boolean(features.hasToolsDeclared) || Number(features.toolMessages || 0) > 0;
  const shortPrompt = normalized.length > 0 && normalized.length <= 240;

  if (categoryId === "high_stakes") return "critical";
  if (safetyGate.actionLike) return "critical";
  if (shortPrompt && !hasTools && isOnboardingLikeRequest(normalized)) return "simple";
  if (shortPrompt && !hasTools && ["communication", "creative", "heartbeat"].includes(categoryId)) return "simple";

  if (features.approxTokens >= 12000 || features.messageCount >= 24) return "critical";
  if (features.approxTokens >= 4500 || features.messageCount >= 14) return "complex";
  if (features.hasMultimodal && features.approxTokens >= 1200) return "complex";

  if (/\b(production outage|incident|root cause|irreversible|mission[- ]critical|compliance)\b/i.test(normalized)) {
    return "critical";
  }
  if (
    /\b(legal|contract)\b/i.test(normalized) &&
    /\b(sign|approve|execute|submit|file|binding|finalize|enforce)\b/i.test(normalized)
  ) {
    return "critical";
  }
  if (/\b(multi-step|multi constraint|algorithm|architecture|deep dive|synthesize|long-form)\b/i.test(normalized)) {
    return "complex";
  }
  if (features.approxTokens <= 280 && !features.hasMultimodal && !features.hasToolsDeclared) return "simple";
  return "standard";
}

function heuristicClassification(lastUserMessage, recentContext, features, safetyGate) {
  const text = `${lastUserMessage}\n${recentContext}`;
  if (safetyGate.triggered) {
    return {
      categoryId: "high_stakes",
      complexity: "critical",
      confidence: 5,
      reason: `Safety gate matched high-stakes signals: ${safetyGate.matchedSignals.join(", ") || "action-like request"}.`,
      matchedSignals: safetyGate.matchedSignals,
      highStakes: true,
      source: "safety_gate"
    };
  }

  const scores = scoreCategoriesWithSignals(text);
  const top = scores[0];
  const categoryId = top && top.score > 0 ? top.id : heuristicCategoryFallback(text, features);
  const complexity = heuristicComplexity(text, features, categoryId, safetyGate);

  return {
    categoryId,
    complexity,
    confidence: top && top.score > 0 ? Math.min(5, 2 + top.score) : 2,
    reason:
      top && top.score > 0
        ? `Signal heuristic matched ${top.score} category cues.`
        : "No strong category signal; used fallback category heuristic.",
    matchedSignals: top?.matchedSignals || [],
    highStakes: false,
    source: "heuristic"
  };
}

function makeOpenRouterHeaders() {
  if (!OPENROUTER_API_KEY) {
    const error = new Error("Missing OPENROUTER_API_KEY.");
    error.status = 500;
    error.code = "missing_openrouter_api_key";
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) headers["X-Title"] = process.env.OPENROUTER_APP_NAME;
  return headers;
}

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

async function callOpenRouter(payload) {
  try {
    const response = await axios.post(OPENROUTER_URL, payload, {
      headers: makeOpenRouterHeaders(),
      timeout: 90000,
      validateStatus: () => true
    });
    if (response.status >= 200 && response.status < 300) return response.data;

    const message =
      response.data?.error?.message ||
      response.data?.message ||
      `OpenRouter request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = response.data?.error?.code;
    error.upstream = response.data;
    throw error;
  } catch (error) {
    if (error.status) throw error;
    const networkError = new Error(`OpenRouter network error: ${error.message}`);
    networkError.status = 502;
    networkError.upstream = { error: { message: networkError.message } };
    throw networkError;
  }
}

async function callOpenRouterStream(payload) {
  try {
    const response = await axios.post(OPENROUTER_URL, payload, {
      headers: makeOpenRouterHeaders(),
      timeout: 0,
      responseType: "stream",
      validateStatus: () => true
    });
    if (response.status >= 200 && response.status < 300) return response;

    const rawBody = await streamToText(response.data);
    const parsed = tryParseJson(rawBody);
    const message =
      parsed?.error?.message ||
      parsed?.message ||
      rawBody ||
      `OpenRouter request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = parsed?.error?.code;
    error.upstream = parsed || { error: { message } };
    throw error;
  } catch (error) {
    if (error.status) throw error;
    const networkError = new Error(`OpenRouter network error: ${error.message}`);
    networkError.status = 502;
    networkError.upstream = { error: { message: networkError.message } };
    throw networkError;
  }
}

function isRetryableModelError(error) {
  const status = Number(error?.status || 0);
  if ([429, 502, 503, 504].includes(status)) return true;
  if (status === 404) return true;
  if (status === 400) {
    const message = String(error?.message || error?.upstream?.error?.message || "").toLowerCase();
    if (/(model|provider|unavailable|not found|capacity|unsupported)/.test(message)) return true;
  }
  return false;
}

function buildCandidatesFromKeys(keys) {
  const candidates = [];
  const seen = new Set();
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    const modelId = modelIdForKey(normalized);
    if (!modelId) continue;
    candidates.push({ modelKey: normalized, modelId });
    seen.add(normalized);
  }
  return candidates;
}

function buildCandidatesForRoute(routeDecision) {
  if (routeDecision.modelId && !routeDecision.modelKey) {
    return [{ modelKey: null, modelId: routeDecision.modelId }];
  }
  if (!routeDecision.modelKey) return [];

  const keys = [routeDecision.modelKey, ...(MODEL_FALLBACKS[routeDecision.modelKey] || [])];
  return buildCandidatesFromKeys(keys);
}

async function callWithModelCandidates(payload, candidates, streamMode = false) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const error = new Error("No candidate models available for request.");
    error.status = 500;
    error.code = "routing_no_candidates";
    throw error;
  }

  const attempted = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const candidatePayload = { ...payload, model: candidate.modelId };
    try {
      const result = streamMode
        ? await callOpenRouterStream(candidatePayload)
        : await callOpenRouter(candidatePayload);
      return {
        result,
        modelKey: candidate.modelKey,
        modelId: candidate.modelId,
        usedFallback: i > 0,
        attempted
      };
    } catch (error) {
      attempted.push({
        model: candidate.modelId,
        status: Number(error?.status || 0) || "n/a",
        message: String(error?.message || "Unknown error").slice(0, 160)
      });
      if (!isRetryableModelError(error) || i === candidates.length - 1) {
        error.attemptedModels = attempted;
        throw error;
      }
    }
  }

  const error = new Error("Model candidate chain exhausted.");
  error.status = 502;
  error.code = "routing_exhausted";
  error.attemptedModels = attempted;
  throw error;
}

async function classifyRequest(lastUserMessage, recentContext, features, safetyGate) {
  const heuristic = heuristicClassification(lastUserMessage, recentContext, features, safetyGate);
  if (safetyGate.triggered) return heuristic;
  if (FORCE_MODEL_ID) {
    return {
      ...heuristic,
      reason: "ASTROLABE_FORCE_MODEL is set; classifier bypassed.",
      source: "forced_model"
    };
  }

  const classifierCandidates = buildCandidatesFromKeys([
    CLASSIFIER_MODEL_KEY,
    "nano",
    "gemFlash",
    "grok",
    "kimiK25",
    "glm5"
  ]);

  const payload = {
    temperature: 0,
    max_tokens: 220,
    stream: false,
    messages: [
      { role: "system", content: CLASSIFIER_PROMPT },
      {
        role: "user",
        content: [
          `Last user message:\n${lastUserMessage || "(none)"}`,
          `Recent context:\n${recentContext || "(none)"}`,
          `Conversation features:\n${JSON.stringify(features)}`
        ].join("\n\n")
      }
    ]
  };

  try {
    const classifierCall = await callWithModelCandidates(payload, classifierCandidates, false);
    const raw = normalizeWhitespace(safeText(classifierCall?.result?.choices?.[0]?.message?.content));
    const parsed = parseClassifierOutput(raw);
    if (!parsed) {
      return {
        ...heuristic,
        reason: "Classifier parse fallback to heuristic.",
        source: "heuristic_fallback"
      };
    }

    const categoryId = parsed.highStakes ? "high_stakes" : parsed.categoryId;
    const complexity = parsed.highStakes ? "critical" : parsed.complexity;
    return {
      categoryId,
      complexity,
      confidence: parsed.confidence,
      reason: parsed.reason || "Classifier model output.",
      matchedSignals: parsed.matchedSignals,
      highStakes: parsed.highStakes,
      source: `model:${classifierCall.modelId}`
    };
  } catch (error) {
    return {
      ...heuristic,
      reason: `Classifier error fallback: ${String(error?.message || "Unknown error").slice(0, 120)}`,
      source: "heuristic_on_classifier_error"
    };
  }
}

function resolveCategoryRoute(categoryId, complexity) {
  const route = (modelKey, label, rule) => ({
    categoryId,
    modelKey,
    modelId: modelIdForKey(modelKey),
    label,
    rule
  });

  switch (categoryId) {
    case "heartbeat":
      if (complexity === "simple") return route("nano", "DEFAULT", "Simple ping / status");
      if (complexity === "standard") return route("grok", "ESCALATE", "Context compaction / memory management");
      return route("glm5", "VALUE", "Complex health diagnostics");

    case "core_loop":
      if (complexity === "critical") return route("opus", "ESCALATE", "Ultra-critical / long-horizon planning");
      if (ROUTING_PROFILE === "budget" && (complexity === "simple" || complexity === "standard")) {
        return route("grok", "BUDGET", "Budget mode / simple tool calls");
      }
      if (complexity === "complex") return route("sonnet", "STANDARD", "Complex tool chain with higher precision needs");
      return route("kimiK25", "VALUE", "Standard tool call");

    case "retrieval":
      if (complexity === "critical") return route("opus", "ESCALATE", "High-stakes retrieval");
      if (complexity === "simple") return route("nano", "DEFAULT", "Simple lookup");
      if (complexity === "complex") return route("sonnet", "STANDARD", "High-precision synthesis across sources");
      return route("kimiK25", "VALUE", "Fetch and synthesize across sources");

    case "summarization":
      if (complexity === "critical") return route("opus", "ESCALATE", "Ultra-critical legal/financial summarization");
      if (complexity === "simple") return route("nano", "DEFAULT", "Short input simple extraction");
      if (complexity === "complex") return route("gem31Pro", "MID-TIER", "Long input or high-precision multimodal extraction");
      return route("kimiK25", "VALUE", "Medium input or multimodal extraction");

    case "planning":
      if (complexity === "critical") return route("opus", "ESCALATE", "Mission-critical planning");
      if (complexity === "simple") return route("grok", "DEFAULT", "Routine planning");
      return route("glm5", "VALUE", "Multi-constraint planning");

    case "orchestration":
      if (complexity === "critical") return route("opus", "ESCALATE", "High-stakes recovery orchestration");
      if (complexity === "simple") return route("grok", "BUDGET", "Simple repetitive orchestration");
      if (complexity === "complex") return route("sonnet", "STANDARD", "Complex automation chain with high injection risk");
      return route("kimiK25", "VALUE", "Standard automation chains");

    case "coding":
      if (complexity === "critical") return route("opus", "ESCALATE", "Large refactors / production-critical");
      if (complexity === "simple") return route("dsCoder", "BUDGET", "Quick script / small fix");
      if (complexity === "complex") return route("sonnet", "STANDARD", "Production-grade review or safety-sensitive refactor");
      return route("glm5", "VALUE", "Standard feature implementation / debugging");

    case "research":
      if (complexity === "critical") return route("opus", "ESCALATE", "Ultra-high-stakes synthesis");
      if (complexity === "complex") return route("sonnet", "STANDARD", "Deep analysis with citations");
      if (complexity === "simple") return route("gem31Pro", "BUDGET", "Long-context or multimodal research synthesis");
      return route("glm5", "VALUE", "Text-heavy synthesis and comparative analysis");

    case "creative":
      if (complexity === "critical") return route("opus", "ESCALATE", "Professional long-form creative campaigns");
      if (complexity === "simple") return route("grok", "DEFAULT", "Brainstorming and playful ideation");
      if (complexity === "complex") return route("sonnet", "STANDARD", "High-precision style and brand consistency");
      return route("kimiK25", "VALUE", "High-quality style adherence");

    case "communication":
      if (complexity === "critical") return route("opus", "ESCALATE", "Sensitive negotiation / legal / crisis messaging");
      if (complexity === "simple") return route("grok", "DEFAULT", "Casual messaging");
      if (complexity === "complex") return route("sonnet", "STANDARD", "Delicate communication requiring maximum precision");
      return route("kimiK25", "VALUE", "Professional communication");

    case "reflection":
      if (complexity === "critical") return route("opus", "ESCALATE", "Critical stuck-state recovery");
      if (complexity === "simple") return route("grok", "DEFAULT", "Routine reflection");
      if (complexity === "complex") return route("sonnet", "STANDARD", "Serious failure analysis with high confidence requirements");
      return route("glm5", "VALUE", "Serious failure analysis");

    case "high_stakes":
      if (ALLOW_HIGH_STAKES_BUDGET_FLOOR && ROUTING_PROFILE === "budget") {
        return route("sonnet", "FLOOR", "Budget forced floor with strict follow-up checks");
      }
      return route("opus", "ALWAYS", "Safety gate hard-route");

    default:
      return route("kimiK25", "VALUE", "Unknown category fallback");
  }
}

function withRoutedModel(routeDecision, modelKey, label, guardrailReason) {
  const modelId = modelIdForKey(modelKey);
  if (!modelId) return routeDecision;
  return {
    ...routeDecision,
    modelKey,
    modelId,
    label: label || routeDecision.label,
    rule: `${routeDecision.rule}; ${guardrailReason}`
  };
}

function valueTierModelForCategory(categoryId) {
  if (["heartbeat", "planning", "coding", "research", "reflection"].includes(categoryId)) return "glm5";
  return "kimiK25";
}

function strictBudgetTarget(routeDecision, features = {}) {
  const categoryId = routeDecision?.categoryId || "communication";
  const complexity = routeDecision?.adjustedComplexity || routeDecision?.complexity || "standard";
  const hasTools = Boolean(features.hasToolsDeclared) || Number(features.toolMessages || 0) > 0;
  const hasMultimodal = Boolean(features.hasMultimodal);
  const approxTokens = Number(features.approxTokens || 0);

  // Non-high-stakes traffic never starts directly on Opus in strict mode.
  if (complexity === "critical") {
    return {
      modelKey: valueTierModelForCategory(categoryId),
      reason: "critical non-high-stakes requests are capped at value tier"
    };
  }

  if (complexity === "complex") {
    if (categoryId === "coding") {
      if (hasTools || hasMultimodal || approxTokens >= 3800) {
        return {
          modelKey: "gem31Pro",
          reason: "complex coding with tools/long context uses mid-tier model first"
        };
      }
      return {
        modelKey: "glm5",
        reason: "complex coding defaults to value engineering tier"
      };
    }

    if (categoryId === "research") {
      if (hasMultimodal || approxTokens >= 5200) {
        return {
          modelKey: "gem31Pro",
          reason: "long-context or multimodal analysis starts on mid-tier model"
        };
      }
      return {
        modelKey: "glm5",
        reason: "complex text-heavy analysis defaults to value reasoning tier"
      };
    }

    if (categoryId === "summarization") {
      if (hasMultimodal || approxTokens >= 5200) {
        return {
          modelKey: "gem31Pro",
          reason: "long-context or multimodal summarization starts on mid-tier model"
        };
      }
      return {
        modelKey: "kimiK25",
        reason: "complex summarization defaults to value multimodal tier"
      };
    }

    if (["planning", "reflection", "heartbeat"].includes(categoryId)) {
      return {
        modelKey: "glm5",
        reason: "complex planning/diagnostic analysis defaults to value reasoning tier"
      };
    }

    if (["core_loop", "retrieval", "orchestration", "creative", "communication"].includes(categoryId)) {
      return {
        modelKey: "kimiK25",
        reason: "complex agentic communication workflows default to value agentic tier"
      };
    }

    return {
      modelKey: "grok",
      reason: "complex non-high-stakes requests default to budget model"
    };
  }

  if (categoryId === "heartbeat") {
    return {
      modelKey: "nano",
      reason: "heartbeat traffic pinned to nano"
    };
  }

  if (categoryId === "retrieval") {
    return {
      modelKey: "nano",
      reason: "routine retrieval stays on nano"
    };
  }

  if (categoryId === "summarization") {
    if (hasMultimodal) {
      return {
        modelKey: "gemFlash",
        reason: "routine multimodal summarization starts on Gemini Flash"
      };
    }
    return {
      modelKey: "nano",
      reason: "routine summarization/extraction stays on nano"
    };
  }

  if (categoryId === "coding") {
    return {
      modelKey: hasTools ? "grok" : "dsCoder",
      reason: hasTools
        ? "routine tool-assisted coding starts on Grok"
        : "routine coding starts on DeepSeek Coder"
    };
  }

  return {
    modelKey: "grok",
    reason: "default strict budget model"
  };
}

function applyCostGuardrails(routeDecision, classification, lastUserMessage, features) {
  if (FORCE_MODEL_ID) return routeDecision;
  if (COST_EFFICIENCY_MODE === "off") return routeDecision;
  if (routeDecision.categoryId === "high_stakes") return routeDecision;

  const requestText = normalizeWhitespace(lastUserMessage);
  const hasTools = Boolean(features?.hasToolsDeclared) || Number(features?.toolMessages || 0) > 0;
  const shortPrompt = requestText.length > 0 && requestText.length <= 240;
  const longContext = Number(features?.approxTokens || 0) >= 1800;
  const hasMultimodal = Boolean(features?.hasMultimodal);

  let next = { ...routeDecision };

  // Most setup/chit-chat traffic should stay on budget models.
  if (isOnboardingLikeRequest(requestText) && !hasTools) {
    next = withRoutedModel(
      next,
      "grok",
      "BUDGET_GUARDRAIL",
      "Cost guardrail: onboarding/social setup forced to budget model."
    );
  }

  if (COST_EFFICIENCY_MODE === "strict") {
    const target = strictBudgetTarget(next, features);
    if (target?.modelKey && target.modelKey !== next.modelKey) {
      next = withRoutedModel(next, target.modelKey, "BUDGET_GUARDRAIL", `Cost guardrail strict: ${target.reason}.`);
    }
  }

  if (!ALLOW_DIRECT_PREMIUM_MODELS) {
    if (next.modelKey === "opus") {
      const downgraded = next.adjustedComplexity === "critical" ? valueTierModelForCategory(next.categoryId) : "grok";
      next = withRoutedModel(
        next,
        downgraded,
        "BUDGET_GUARDRAIL",
        "Cost guardrail: blocked direct Opus route for non-high-stakes request."
      );
    }
    if (next.modelKey === "sonnet") {
      const shouldDowngradeSonnet =
        next.adjustedComplexity === "simple" ||
        next.adjustedComplexity === "standard" ||
        (COST_EFFICIENCY_MODE === "strict" &&
          next.adjustedComplexity !== "critical" &&
          shortPrompt &&
          !hasTools &&
          !longContext &&
          !hasMultimodal);
      if (shouldDowngradeSonnet) {
        next = withRoutedModel(
          next,
          "grok",
          "BUDGET_GUARDRAIL",
          "Cost guardrail: downgraded Sonnet for low-complexity request."
        );
      }
    }
  }

  if (
    COST_EFFICIENCY_MODE === "strict" &&
    next.modelKey === "gem31Pro" &&
    shortPrompt &&
    !hasTools &&
    !longContext &&
    !hasMultimodal
  ) {
    next = withRoutedModel(
      next,
      "grok",
      "BUDGET_GUARDRAIL",
      "Cost guardrail: downgraded Gem31Pro for short conversational request."
    );
  }

  return next;
}

function resolveRouteDecision(classification, safetyGate) {
  if (FORCE_MODEL_ID) {
    return {
      categoryId: classification.categoryId,
      complexity: classification.complexity,
      adjustedComplexity: classification.complexity,
      modelKey: null,
      modelId: FORCE_MODEL_ID,
      label: "FORCED",
      rule: "ASTROLABE_FORCE_MODEL override",
      injectionRisk: CATEGORY_BY_ID.get(classification.categoryId)?.injectionRisk || "UNKNOWN",
      safetyGateTriggered: safetyGate.triggered
    };
  }

  const categoryId = normalizeCategoryId(classification.categoryId) || "communication";
  const baseComplexity = normalizeComplexity(classification.complexity) || "standard";
  const adjustedComplexity = applyRoutingProfile(baseComplexity, categoryId);
  const route = resolveCategoryRoute(categoryId, adjustedComplexity);

  return {
    categoryId,
    complexity: baseComplexity,
    adjustedComplexity,
    modelKey: route.modelKey,
    modelId: route.modelId,
    label: route.label,
    rule: route.rule,
    injectionRisk: CATEGORY_BY_ID.get(categoryId)?.injectionRisk || "UNKNOWN",
    safetyGateTriggered: safetyGate.triggered
  };
}

function shouldEscalateFromSelfCheck(score, routeDecision) {
  if (FORCE_MODEL_ID || routeDecision?.label === "FORCED") return false;
  if (score >= 4) return false;
  if (score <= 1) return true;
  if (routeDecision.categoryId === "high_stakes") return true;
  if (COST_EFFICIENCY_MODE === "strict") {
    if (routeDecision.adjustedComplexity === "critical") return true;
    if (routeDecision.adjustedComplexity === "complex") return true;
    return false;
  }
  return true;
}

function buildEscalationTarget(modelKey, score, routeDecision = null) {
  if (FORCE_MODEL_ID || routeDecision?.label === "FORCED") return null;
  if (score >= 4) return null;
  if (modelKey === "opus") return null;
  if (score <= 1) {
    if (
      COST_EFFICIENCY_MODE === "strict" &&
      routeDecision?.categoryId !== "high_stakes" &&
      routeDecision?.adjustedComplexity !== "critical"
    ) {
      if (!modelKey) return "kimiK25";
      return ESCALATION_PATH[modelKey] || "kimiK25";
    }
    return "opus";
  }
  if (!modelKey) return "opus";
  return ESCALATION_PATH[modelKey] || "opus";
}

async function runSelfCheck(lastUserMessage, assistantText) {
  const selfCheckCandidates = buildCandidatesFromKeys([
    SELF_CHECK_MODEL_KEY,
    "nano",
    "gemFlash",
    "grok",
    "kimiK25",
    "glm5"
  ]);
  const payload = {
    temperature: 0,
    max_tokens: 80,
    stream: false,
    messages: [
      { role: "system", content: SELF_CHECK_PROMPT },
      {
        role: "user",
        content: `User request:\n${lastUserMessage || "(none)"}\n\nAssistant answer:\n${assistantText || "(empty)"}`
      }
    ]
  };

  try {
    const checked = await callWithModelCandidates(payload, selfCheckCandidates, false);
    const raw = normalizeWhitespace(safeText(checked?.result?.choices?.[0]?.message?.content));
    const parsed = parseSelfCheckOutput(raw);
    return {
      ...parsed,
      source: checked.modelId
    };
  } catch (error) {
    return {
      score: 4,
      reason: `Self-check skipped on error: ${String(error?.message || "unknown").slice(0, 120)}`,
      source: "fallback"
    };
  }
}

function isHighStakesConfirmed(req, body) {
  const matchesConfirmToken = (value) =>
    typeof value === "string" && value.trim().toLowerCase() === HIGH_STAKES_CONFIRM_TOKEN;

  if (matchesConfirmToken(req.headers["x-astrolabe-confirmed"])) return true;
  if (matchesConfirmToken(body?.metadata?.astrolabe_confirmed)) return true;
  if (matchesConfirmToken(body?.astrolabe_confirmed)) return true;
  return false;
}

function maybeInjectHighStakesPrompt(messages) {
  if (!Array.isArray(messages)) return messages;
  const alreadyPresent = messages.some((msg) => safeText(msg?.content).includes("[ASTROLABE_HIGH_STAKES_POLICY]"));
  if (alreadyPresent) return messages;
  return [{ role: "system", content: HIGH_STAKES_POLICY_PROMPT }, ...messages];
}

function estimateCost(modelId, usage) {
  const pricing = pricePer1M[modelId];
  if (!pricing || !usage) return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
  const usd = (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
  return { promptTokens, completionTokens, totalTokens, usd };
}

function buildErrorBody(status, error) {
  const upstreamMessage = error?.upstream?.error?.message || error?.message || "Unknown error";
  const exposeMessage = status >= 500 ? "Internal server error." : upstreamMessage;
  return {
    error: {
      message: exposeMessage,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: error?.code || error?.upstream?.error?.code
    }
  };
}

function setRoutingHeaders(res, metadata) {
  const headers = {
    "x-astrolabe-category": metadata.categoryId,
    "x-astrolabe-complexity": metadata.complexity,
    "x-astrolabe-adjusted-complexity": metadata.adjustedComplexity,
    "x-astrolabe-initial-model": metadata.initialModelId,
    "x-astrolabe-final-model": metadata.finalModelId,
    "x-astrolabe-route-label": metadata.routeLabel,
    "x-astrolabe-escalated": String(Boolean(metadata.escalated)),
    "x-astrolabe-confidence-score": String(metadata.confidenceScore ?? ""),
    "x-astrolabe-low-confidence": String(Boolean(metadata.lowConfidence)),
    "x-astrolabe-safety-gate": String(Boolean(metadata.safetyGateTriggered))
  };

  for (const [name, value] of Object.entries(headers)) {
    if (value == null || value === "") continue;
    res.setHeader(name, String(value));
  }
}

app.get("/health", (req, res) => {
  return res.status(200).json({
    ok: true,
    service: "astrolabe",
    version: "0.2.0-beta.1",
    routing_profile: ROUTING_PROFILE,
    cost_efficiency_mode: COST_EFFICIENCY_MODE,
    allow_direct_premium_models: ALLOW_DIRECT_PREMIUM_MODELS,
    safety_gate: ENABLE_SAFETY_GATE
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let routeDecision = {
    categoryId: "core_loop",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "sonnet",
    modelId: modelIdForKey("sonnet"),
    label: "DEFAULT",
    rule: "Default fallback",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  let classifierResult = null;

  try {
    const body = req.body;
    if (!body || !Array.isArray(body.messages)) {
      return res.status(400).json({
        error: {
          message: "Invalid request: 'messages' array is required.",
          type: "invalid_request_error"
        }
      });
    }

    const streamRequested = body.stream !== false;
    const lastUserMessage = extractLastUserMessage(body.messages);
    const recentContext = buildRecentContext(body.messages);
    const features = extractConversationFeatures(body.messages, body);
    const safetyText = `${lastUserMessage}\n${recentContext}`;
    const safetyGate = detectSafetyGate(safetyText);

    if (safetyGate.triggered && HIGH_STAKES_CONFIRM_MODE === "strict" && !isHighStakesConfirmed(req, body)) {
      return res.status(409).json({
        error: {
          message: `High-stakes request blocked pending confirmation. Resend with header ` +
            `\`x-astrolabe-confirmed: ${HIGH_STAKES_CONFIRM_TOKEN}\` or set ` +
            `\`metadata.astrolabe_confirmed="${HIGH_STAKES_CONFIRM_TOKEN}"\`.`,
          type: "safety_confirmation_required",
          code: "high_stakes_confirmation_required",
          details: {
            matched_signals: safetyGate.matchedSignals
          }
        }
      });
    }

    classifierResult = await classifyRequest(lastUserMessage, recentContext, features, safetyGate);
    routeDecision = resolveRouteDecision(classifierResult, safetyGate);
    routeDecision = applyCostGuardrails(routeDecision, classifierResult, lastUserMessage, features);

    const outboundMessages =
      safetyGate.triggered && HIGH_STAKES_CONFIRM_MODE === "prompt"
        ? maybeInjectHighStakesPrompt(body.messages)
        : body.messages;
    const basePayload = { ...body, messages: outboundMessages };

    const primaryCandidates = buildCandidatesForRoute(routeDecision);
    const primaryCall = await callWithModelCandidates(
      { ...basePayload, stream: streamRequested },
      primaryCandidates,
      streamRequested
    );

    const initialModelId = primaryCall.modelId;
    let finalModelId = initialModelId;
    let finalModelKey = primaryCall.modelKey;
    let escalated = false;
    let lowConfidence = false;
    let confidenceScore = null;

    if (streamRequested) {
      const upstream = primaryCall.result;
      const upstreamStream = upstream.data;
      const latency = Date.now() - startedAt;

      setRoutingHeaders(res, {
        categoryId: routeDecision.categoryId,
        complexity: routeDecision.complexity,
        adjustedComplexity: routeDecision.adjustedComplexity,
        initialModelId,
        finalModelId,
        routeLabel: routeDecision.label,
        escalated: false,
        confidenceScore: "",
        lowConfidence: false,
        safetyGateTriggered: routeDecision.safetyGateTriggered
      });

      console.log(
        `[${requestId}] category=${routeDecision.categoryId} complexity=${routeDecision.complexity}->${routeDecision.adjustedComplexity} ` +
          `risk=${routeDecision.injectionRisk} chosen_model=${initialModelId} final_model=${finalModelId} route=${routeDecision.label} ` +
          `classifier_source=${classifierResult?.source || "n/a"} classifier_reason="${normalizeWhitespace(classifierResult?.reason || "")}" ` +
          `selfcheck=skipped reason="streaming" escalated=false low_confidence=false latency_ms=${latency} stream=true`
      );

      res.status(200);
      res.setHeader("Content-Type", upstream.headers["content-type"] || "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      req.on("close", () => {
        if (typeof upstreamStream.destroy === "function") upstreamStream.destroy();
      });

      upstreamStream.on("error", (streamError) => {
        const streamMessage = streamError?.message || "OpenRouter stream error";
        console.error(
          `[${requestId}] error status=502 category=${routeDecision.categoryId} model=${finalModelId} ` +
            `message="${streamMessage}" latency_ms=${Date.now() - startedAt}`
        );
        if (!res.headersSent) {
          res.status(502).json(buildErrorBody(502, streamError));
          return;
        }
        res.end();
      });

      upstreamStream.pipe(res);
      return;
    }

    let finalResponse = primaryCall.result;
    if (routeDecision.label === "FORCED") {
      if (!finalResponse || !Array.isArray(finalResponse.choices)) {
        const malformed = new Error("Malformed OpenRouter response.");
        malformed.status = 502;
        throw malformed;
      }

      setRoutingHeaders(res, {
        categoryId: routeDecision.categoryId,
        complexity: routeDecision.complexity,
        adjustedComplexity: routeDecision.adjustedComplexity,
        initialModelId,
        finalModelId,
        routeLabel: routeDecision.label,
        escalated: false,
        confidenceScore: "",
        lowConfidence: false,
        safetyGateTriggered: routeDecision.safetyGateTriggered
      });

      const cost = estimateCost(finalModelId, finalResponse.usage) || {};
      const latency = Date.now() - startedAt;
      console.log(
        `[${requestId}] category=${routeDecision.categoryId} complexity=${routeDecision.complexity}->${routeDecision.adjustedComplexity} ` +
          `risk=${routeDecision.injectionRisk} chosen_model=${initialModelId} final_model=${finalModelId} route=${routeDecision.label} ` +
          `classifier_source=${classifierResult?.source || "n/a"} classifier_reason="${normalizeWhitespace(classifierResult?.reason || "")}" ` +
          `selfcheck=skipped reason="forced_model" escalated=false low_confidence=false ` +
          `tokens=${cost.promptTokens ?? "n/a"}/${cost.completionTokens ?? "n/a"}/${cost.totalTokens ?? "n/a"} ` +
          `est_usd=${typeof cost.usd === "number" ? cost.usd.toFixed(6) : "n/a"} latency_ms=${latency} stream=false`
      );

      return res.status(200).json(finalResponse);
    }

    const firstAnswer = safeText(finalResponse?.choices?.[0]?.message?.content);
    const firstSelfCheck = await runSelfCheck(lastUserMessage, firstAnswer);
    confidenceScore = firstSelfCheck.score;

    let escalationTarget = null;
    if (shouldEscalateFromSelfCheck(firstSelfCheck.score, routeDecision)) {
      escalationTarget = buildEscalationTarget(finalModelKey, firstSelfCheck.score, routeDecision);
    }
    if (routeDecision.categoryId === "high_stakes" && routeDecision.label === "FLOOR" && firstSelfCheck.score < 5) {
      escalationTarget = "opus";
    }

    if (escalationTarget && modelIdForKey(escalationTarget) && finalModelKey !== escalationTarget) {
      escalated = true;
      const escalationCandidates = buildCandidatesForRoute({
        modelKey: escalationTarget,
        modelId: modelIdForKey(escalationTarget)
      });
      const escalatedCall = await callWithModelCandidates({ ...basePayload, stream: false }, escalationCandidates, false);
      finalResponse = escalatedCall.result;
      finalModelId = escalatedCall.modelId;
      finalModelKey = escalatedCall.modelKey;

      const secondAnswer = safeText(finalResponse?.choices?.[0]?.message?.content);
      const secondSelfCheck = await runSelfCheck(lastUserMessage, secondAnswer);
      confidenceScore = secondSelfCheck.score;
      lowConfidence = secondSelfCheck.score <= 3;
      if (routeDecision.categoryId === "high_stakes" && secondSelfCheck.score < 4) lowConfidence = true;
    } else {
      lowConfidence = firstSelfCheck.score <= 3;
      if (routeDecision.categoryId === "high_stakes" && firstSelfCheck.score < 4) lowConfidence = true;
    }

    if (!finalResponse || !Array.isArray(finalResponse.choices)) {
      const malformed = new Error("Malformed OpenRouter response.");
      malformed.status = 502;
      throw malformed;
    }

    setRoutingHeaders(res, {
      categoryId: routeDecision.categoryId,
      complexity: routeDecision.complexity,
      adjustedComplexity: routeDecision.adjustedComplexity,
      initialModelId,
      finalModelId,
      routeLabel: routeDecision.label,
      escalated,
      confidenceScore,
      lowConfidence,
      safetyGateTriggered: routeDecision.safetyGateTriggered
    });

    const cost = estimateCost(finalModelId, finalResponse.usage) || {};
    const latency = Date.now() - startedAt;
    console.log(
      `[${requestId}] category=${routeDecision.categoryId} complexity=${routeDecision.complexity}->${routeDecision.adjustedComplexity} ` +
        `risk=${routeDecision.injectionRisk} chosen_model=${initialModelId} final_model=${finalModelId} route=${routeDecision.label} ` +
        `classifier_source=${classifierResult?.source || "n/a"} classifier_reason="${normalizeWhitespace(classifierResult?.reason || "")}" ` +
        `selfcheck_score=${confidenceScore ?? "n/a"} escalated=${escalated} low_confidence=${lowConfidence} ` +
        `tokens=${cost.promptTokens ?? "n/a"}/${cost.completionTokens ?? "n/a"}/${cost.totalTokens ?? "n/a"} ` +
        `est_usd=${typeof cost.usd === "number" ? cost.usd.toFixed(6) : "n/a"} latency_ms=${latency} stream=false`
    );

    return res.status(200).json(finalResponse);
  } catch (error) {
    const rawStatus = Number(error?.status) || 500;
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const latency = Date.now() - startedAt;
    const upstreamMessage = error?.upstream?.error?.message || error?.message || "Unknown error";
    console.error(
      `[${requestId}] error status=${status} category=${routeDecision.categoryId} model=${routeDecision.modelId} ` +
        `reason="${normalizeWhitespace(classifierResult?.reason || routeDecision.rule || "")}" ` +
        `message="${upstreamMessage}" latency_ms=${latency}`
    );
    return res.status(status).json(buildErrorBody(status, error));
  }
});

function startServer() {
  if (!OPENROUTER_API_KEY) {
    console.error("Missing OPENROUTER_API_KEY. Set it in your environment and restart.");
    process.exit(1);
  }
  if (!ASTROLABE_API_KEY) {
    console.warn("Warning: ASTROLABE_API_KEY is not set. Your public endpoint is unauthenticated.");
  }
  app.listen(PORT, () => {
    console.log(`Astrolabe listening on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  internals: {
    MODELS,
    CATEGORY_POLICIES,
    detectSafetyGate,
    heuristicClassification,
    parseClassifierOutput,
    parseSelfCheckOutput,
    resolveCategoryRoute,
    resolveRouteDecision,
    applyCostGuardrails,
    shouldEscalateFromSelfCheck,
    buildEscalationTarget,
    applyRoutingProfile,
    isOnboardingLikeRequest,
    normalizeCategoryId,
    normalizeComplexity,
    normalizeRoutingProfile,
    normalizeHighStakesConfirmMode,
    isHighStakesConfirmed,
    HIGH_STAKES_CONFIRM_TOKEN,
    ROUTING_PROFILE,
    COST_EFFICIENCY_MODE,
    ALLOW_DIRECT_PREMIUM_MODELS
  }
};

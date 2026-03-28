function envFlag(env, name, defaultValue = false) {
  const raw = env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
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

function normalizeDefaultProfile(profile) {
  if (profile === "strict-budget") return "strict-budget";
  if (profile === "safe-untrusted") return "safe-untrusted";
  if (profile === "low-latency") return "low-latency";
  if (profile === "max-capability") return "max-capability";
  return "default";
}

function splitAllowlist(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createConfig(env = process.env) {
  return {
    OPENROUTER_API_KEY: String(env.OPENROUTER_API_KEY || "").trim(),
    ASTROLABE_API_KEY: String(env.ASTROLABE_API_KEY || "").trim(),
    PORT: Number(env.PORT) || 3000,
    OPENROUTER_BASE_URL: String(env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim(),
    OPENROUTER_SITE_URL: String(env.OPENROUTER_SITE_URL || "").trim(),
    OPENROUTER_APP_NAME: String(env.OPENROUTER_APP_NAME || "").trim(),
    ROUTING_PROFILE: normalizeRoutingProfile(
      String(env.ASTROLABE_ROUTING_PROFILE || "budget")
        .trim()
        .toLowerCase()
    ),
    COST_EFFICIENCY_MODE: normalizeCostMode(
      String(env.ASTROLABE_COST_EFFICIENCY_MODE || "strict")
        .trim()
        .toLowerCase()
    ),
    ALLOW_DIRECT_PREMIUM_MODELS: envFlag(env, "ASTROLABE_ALLOW_DIRECT_PREMIUM_MODELS", false),
    ENABLE_SAFETY_GATE: envFlag(env, "ASTROLABE_ENABLE_SAFETY_GATE", true),
    HIGH_STAKES_CONFIRM_MODE: normalizeHighStakesConfirmMode(
      String(env.ASTROLABE_HIGH_STAKES_CONFIRM_MODE || "prompt")
        .trim()
        .toLowerCase()
    ),
    HIGH_STAKES_CONFIRM_TOKEN:
      String(env.ASTROLABE_HIGH_STAKES_CONFIRM_TOKEN || "confirm")
        .trim()
        .toLowerCase() || "confirm",
    ALLOW_HIGH_STAKES_BUDGET_FLOOR: envFlag(env, "ASTROLABE_ALLOW_HIGH_STAKES_BUDGET_FLOOR", false),
    FORCE_MODEL_ID: String(env.ASTROLABE_FORCE_MODEL || "").trim(),
    CLASSIFIER_MODEL_KEY: String(env.ASTROLABE_CLASSIFIER_MODEL_KEY || "nano")
      .trim()
      .toLowerCase(),
    SELF_CHECK_MODEL_KEY: String(env.ASTROLABE_SELF_CHECK_MODEL_KEY || "mini")
      .trim()
      .toLowerCase(),
    CLASSIFIER_CONTEXT_MESSAGES: clampInt(env.ASTROLABE_CONTEXT_MESSAGES, 8, 3, 20),
    CLASSIFIER_CONTEXT_CHARS: clampInt(env.ASTROLABE_CONTEXT_CHARS, 2500, 600, 12000),
    RATE_LIMIT_ENABLED: envFlag(env, "ASTROLABE_RATE_LIMIT_ENABLED", false),
    RATE_LIMIT_WINDOW_MS: clampInt(env.ASTROLABE_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000),
    RATE_LIMIT_MAX_REQUESTS: clampInt(env.ASTROLABE_RATE_LIMIT_MAX_REQUESTS, 120, 1, 100_000),
    RESPONSES_ENABLED: envFlag(env, "ASTROLABE_RESPONSES_ENABLED", true),
    CHAT_COMPLETIONS_ENABLED: envFlag(env, "ASTROLABE_CHAT_COMPLETIONS_ENABLED", true),
    DEFAULT_PROFILE: normalizeDefaultProfile(
      String(env.ASTROLABE_DEFAULT_PROFILE || "default")
        .trim()
        .toLowerCase()
    ),
    RESPONSES_FILES_URL_ALLOWLIST: splitAllowlist(env.ASTROLABE_RESPONSES_FILES_URL_ALLOWLIST),
    RESPONSES_IMAGES_URL_ALLOWLIST: splitAllowlist(env.ASTROLABE_RESPONSES_IMAGES_URL_ALLOWLIST),
    RESPONSES_MAX_URL_PARTS: clampInt(env.ASTROLABE_RESPONSES_MAX_URL_PARTS, 12, 1, 64)
  };
}

module.exports = {
  clampInt,
  createConfig,
  envFlag,
  normalizeCostMode,
  normalizeDefaultProfile,
  normalizeHighStakesConfirmMode,
  normalizeRoutingProfile
};

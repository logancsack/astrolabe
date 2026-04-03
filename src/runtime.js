const {
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
} = require("./manifests");
const {
  callOpenRouterChat,
  callOpenRouterChatStream,
  callOpenRouterResponses,
  callOpenRouterResponsesStream,
  isRetryableModelError
} = require("./upstream");

const HIGH_STAKES_ACTION_REGEX = /\b(transfer|wire|send money|payment|pay|purchase|buy|sell|contract sign|approve|delete|erase|reset password|share pii|submit legal|deploy|rollback|terminate)\b/i;
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
const ARCHITECTURE_SIGNAL_REGEX =
  /\b(architecture|architect|system design|design doc|scalability|migrate|migration|distributed|service boundaries|module boundaries|codebase[-\s]?wide)\b/i;
const DEEP_ANALYSIS_SIGNAL_REGEX =
  /\b(deep[-\s]?analysis|deep[-\s]?dive|citation|citations|cite|sources?|comparison|compare|comparative|competitive|literature|benchmark|trade[-\s]?off|synthesize)\b/i;
const TOOL_APPROVAL_REGEX = /\b(delete|erase|destroy|wire|transfer|payment|purchase|buy|sell|password|credential|secret|ssh|terminate|deploy|rollback|production)\b/i;
const TOOL_MUTATION_REGEX = /\b(delete|write|create|update|deploy|rollback|commit|push|purchase|send|transfer|terminate|execute)\b/i;
const TOOL_BLOCK_REGEX = /\b(shell|exec|system|browser|web_fetch|web-search|http|curl|wget|powershell|bash)\b/i;
const URL_SCHEME_REGEX = /^https?:\/\//i;
const LOW_RISK_CATEGORIES = new Set(["heartbeat", "retrieval", "summarization", "creative", "communication"]);
const M27_WORKHORSE_CATEGORIES = new Set(["core_loop", "planning", "orchestration", "coding", "research", "reflection"]);

function safeText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (typeof item.text === "string") return item.text;
        if (typeof item.input_text === "string") return item.input_text;
        if (typeof item.output_text === "string") return item.output_text;
        if (typeof item.arguments === "string") return item.arguments;
        if (typeof item.content === "string") return item.content;
        if (item.type === "text" && typeof item.text === "string") return item.text;
        if (item.type === "input_text" && typeof item.text === "string") return item.text;
        if (item.type === "output_text" && typeof item.text === "string") return item.text;
        if (item.type === "message") return safeText(item.content);
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.input_text === "string") return value.input_text;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.arguments === "string") return value.arguments;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCategoryId(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[ -]/g, "_");
  return CATEGORY_BY_ID.has(value) ? value : null;
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

function shiftComplexity(complexity, delta) {
  const index = COMPLEXITY_ORDER.indexOf(complexity);
  if (index < 0) return complexity;
  const next = Math.max(0, Math.min(COMPLEXITY_ORDER.length - 1, index + delta));
  return COMPLEXITY_ORDER[next];
}

function riskRank(risk) {
  if (risk === "CRITICAL") return 5;
  if (risk === "HIGH") return 4;
  if (risk === "MEDIUM-HIGH") return 3;
  if (risk === "MEDIUM") return 2;
  return 1;
}

function extractFirstJsonObject(rawText) {
  const text = String(rawText || "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
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
        modifiers: Array.isArray(object.modifiers)
          ? dedupe(object.modifiers.map((value) => String(value).trim().toLowerCase()))
          : [],
        reason: normalizeWhitespace(object.reason || "Model classifier."),
        matchedSignals: Array.isArray(object.matched_signals)
          ? dedupe(object.matched_signals.map((value) => String(value).trim().toLowerCase()))
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
    return {
      categoryId: normalizeCategoryId(fallbackCategoryMatch[1]),
      complexity: normalizeComplexity(fallbackComplexityMatch[1]),
      confidence: 3,
      modifiers: [],
      reason: "Classifier parsed from loose text.",
      matchedSignals: [],
      highStakes: /high_stakes/i.test(fallbackCategoryMatch[1])
    };
  }
  return null;
}

function parseVerifierOutput(raw) {
  const direct = tryParseJson(raw);
  const embedded = direct || tryParseJson(extractFirstJsonObject(raw) || "");
  const object = embedded && typeof embedded === "object" ? embedded : null;
  if (object) {
    return {
      score: parseScore(object.score, 4),
      reason: normalizeWhitespace(object.reason || "Verifier scored by model.")
    };
  }
  const loose = String(raw || "").match(/\b([1-5])\b\s*[:|-]?\s*(.{0,180})/);
  if (loose) {
    return {
      score: parseScore(loose[1], 4),
      reason: normalizeWhitespace(loose[2] || "Verifier parsed from loose text.")
    };
  }
  return { score: 4, reason: "Verifier parse fallback (score=4)." };
}

function extractToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return dedupe(
    tools.map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      if (tool.type === "function") return tool.function?.name || null;
      return tool.name || tool.type || null;
    })
  );
}

function extractLastUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = normalizeWhitespace(safeText(message.content));
    if (text) return text;
  }
  return "";
}

function buildRecentContext(messages, config) {
  const recent = messages.slice(-config.CLASSIFIER_CONTEXT_MESSAGES);
  return recent
    .map((message) => `${message?.role || "unknown"}: ${normalizeWhitespace(safeText(message?.content)).slice(0, 320)}`)
    .join("\n")
    .slice(0, config.CLASSIFIER_CONTEXT_CHARS);
}

function extractConversationFeatures(messages, body = {}) {
  const stats = {
    messageCount: Array.isArray(messages) ? messages.length : 0,
    userMessages: 0,
    systemMessages: 0,
    assistantMessages: 0,
    toolMessages: 0,
    hasMultimodal: false,
    hasToolsDeclared: Array.isArray(body.tools) && body.tools.length > 0,
    toolNames: extractToolNames(body.tools),
    approxChars: 0,
    approxTokens: 0
  };
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "user") stats.userMessages += 1;
    if (message.role === "system") stats.systemMessages += 1;
    if (message.role === "assistant") stats.assistantMessages += 1;
    if (message.role === "tool") stats.toolMessages += 1;
    const content = message.content;
    const text = safeText(content);
    stats.approxChars += text.length;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && part.type && part.type !== "text" && part.type !== "input_text") {
          stats.hasMultimodal = true;
        }
      }
    }
  }
  stats.approxTokens = Math.ceil(stats.approxChars / 4);
  return stats;
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

function hasArchitectureSignals(text) {
  return ARCHITECTURE_SIGNAL_REGEX.test(String(text || ""));
}

function hasDeepAnalysisSignals(text) {
  return DEEP_ANALYSIS_SIGNAL_REGEX.test(String(text || ""));
}

function detectSafetyGate(text) {
  const normalizedText = normalizeWhitespace(text).toLowerCase();
  const matchedSignals = [];
  if (HIGH_STAKES_ACTION_REGEX.test(normalizedText)) matchedSignals.push("action_like");
  for (const phrase of HIGH_STAKES_SYNONYMS) {
    if (normalizedText.includes(phrase)) matchedSignals.push(phrase);
  }
  for (const weakSignal of HIGH_STAKES_WEAK_SIGNALS) {
    if (normalizedText.includes(weakSignal)) matchedSignals.push(weakSignal);
  }
  const actionLike = matchedSignals.includes("action_like");
  const strongSignals = matchedSignals.filter((signal) => signal !== "action_like" && !HIGH_STAKES_WEAK_SIGNALS.has(signal));
  const weakSignals = matchedSignals.filter((signal) => HIGH_STAKES_WEAK_SIGNALS.has(signal));
  const triggered =
    actionLike ||
    strongSignals.length >= 1 ||
    (weakSignals.length >= 2 && /sensitive|account|password|legal|medical|bank/i.test(normalizedText));
  return {
    triggered,
    matchedSignals: dedupe(matchedSignals),
    actionLike
  };
}

function isOnboardingLikeRequest(text) {
  const normalized = String(text || "");
  return ONBOARDING_CHAT_REGEX.test(normalized) || CASUAL_CHAT_REGEX.test(normalized);
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeText(content);
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (part.type === "input_text" && typeof part.text === "string") return part.text;
      if (part.type === "image_url" || part.type === "input_image") return "[image]";
      if (part.type === "input_file") return "[file]";
      return safeText(part);
    })
    .filter(Boolean)
    .join(" ");
}

function normalizeResponsesMessageItem(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "message") {
    return {
      role: item.role || "user",
      content: item.content || []
    };
  }
  if (item.type === "reasoning") {
    return {
      role: "assistant",
      content: [
        {
          type: "input_text",
          text: safeText(item.summary || item.content || item.text || "[reasoning]")
        }
      ],
      astrolabe_reasoning: item
    };
  }
  if (item.type === "item_reference") {
    return {
      role: "system",
      content: [
        {
          type: "input_text",
          text: `[item_reference:${item.id || item.item_id || item.reference_id || "unknown"}]`
        }
      ],
      astrolabe_item_reference: item
    };
  }
  if (item.type === "function_call_output") {
    return {
      role: "tool",
      content: safeText(item.output || item.content || ""),
      tool_call_id: item.call_id || item.id || undefined
    };
  }
  if (item.type === "function_call") {
    return {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: item.call_id || item.id || "call_astrolabe",
          type: "function",
          function: {
            name: item.name || item.function?.name || "tool",
            arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
          }
        }
      ]
    };
  }
  return {
    role: "user",
    content: [{ type: "input_text", text: safeText(item) }]
  };
}

function responsesInputToMessages(input, instructions) {
  const messages = [];
  if (instructions) {
    messages.push({
      role: "system",
      content: String(instructions)
    });
  }
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const message = normalizeResponsesMessageItem(item);
      if (message) messages.push(message);
    }
  }
  if (!messages.length) messages.push({ role: "user", content: "" });
  return messages;
}

function normalizeResponsesRequest(body) {
  const stream = body.stream === true;
  const messages = responsesInputToMessages(body.input, body.instructions);
  return {
    api: "responses",
    stream,
    body,
    requestedModel: body.model || "astrolabe/auto",
    metadata: body.metadata || {},
    messages,
    instructions: body.instructions || "",
    responsesInput: body.input,
    tools: Array.isArray(body.tools) ? body.tools : [],
    toolChoice: body.tool_choice,
    responseFormat: body.response_format || body.text?.format || null,
    reasoning: body.reasoning || null,
    text: body.text || null,
    maxOutputTokens: body.max_output_tokens,
    inputText: normalizeWhitespace(messages.map((message) => normalizeMessageContent(message.content)).join("\n"))
  };
}

function normalizeChatRequest(body) {
  return {
    api: "chat",
    stream: body.stream === true,
    body,
    requestedModel: body.model || "astrolabe/auto",
    metadata: body.metadata || {},
    messages: Array.isArray(body.messages) ? body.messages : [],
    instructions: "",
    responsesInput: null,
    tools: Array.isArray(body.tools) ? body.tools : [],
    toolChoice: body.tool_choice,
    responseFormat: body.response_format || null,
    reasoning: body.reasoning || null,
    text: null,
    maxOutputTokens: body.max_output_tokens || body.max_tokens,
    inputText: normalizeWhitespace(
      (Array.isArray(body.messages) ? body.messages : []).map((message) => normalizeMessageContent(message.content)).join("\n")
    )
  };
}

function parseAllowlistEntry(entry) {
  if (!entry) return null;
  const value = String(entry).trim();
  if (!value) return null;
  if (URL_SCHEME_REGEX.test(value)) {
    try {
      const url = new URL(value);
      return { type: "origin", value: url.origin.toLowerCase() };
    } catch {
      return null;
    }
  }
  return { type: "host", value: value.toLowerCase() };
}

function isUrlAllowed(urlString, allowlist) {
  if (!allowlist.length) return true;
  try {
    const url = new URL(urlString);
    const origin = url.origin.toLowerCase();
    const host = url.hostname.toLowerCase();
    return allowlist.some((rule) => {
      if (!rule) return false;
      if (rule.type === "origin") return origin === rule.value;
      return host === rule.value || host.endsWith(`.${rule.value}`);
    });
  } catch {
    return false;
  }
}

function collectResponsesUrlParts(input) {
  const urls = [];
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "string") return;
    if (typeof value !== "object") return;
    if (value.type === "input_image" && typeof value.image_url === "string") urls.push(value.image_url);
    if (value.type === "image_url" && typeof value.image_url?.url === "string") urls.push(value.image_url.url);
    if (value.type === "input_file" && typeof value.file_url === "string") urls.push(value.file_url);
    if (typeof value.url === "string") urls.push(value.url);
    if (typeof value.image_url === "string") urls.push(value.image_url);
    for (const nested of Object.values(value)) visit(nested);
  }
  visit(input);
  return dedupe(urls.filter((value) => URL_SCHEME_REGEX.test(value)));
}

function buildCandidatesFromKeys(keys, options = {}) {
  const multimodal = Boolean(options.multimodal);
  const entries = [];
  for (const rawKey of keys) {
    const resolvedKey = resolveModelAlias(String(rawKey || "").trim());
    const model = modelEntryForKey(resolvedKey);
    if (!model) continue;
    if (multimodal && !model.modalities.includes("image")) continue;
    entries.push({
      key: resolvedKey,
      modelId: model.id,
      short: model.short,
      tier: model.tier
    });
  }
  return dedupe(entries.map((entry) => entry.key)).map((key) => ({
    key,
    modelId: modelIdForKey(key),
    short: modelShortForKey(key),
    tier: modelEntryForKey(key)?.tier || "UNKNOWN"
  }));
}

function isStrictSchemaFormat(format) {
  if (!format) return false;
  if (typeof format === "string") return /\b(json|schema)\b/i.test(format);
  const type = String(format.type || format.name || "").trim().toLowerCase();
  return type === "json_object" || type === "json_schema";
}

function hasExplicitStructuredOutputRequest(normalized, hints = {}) {
  const text = String(normalized.inputText || "").toLowerCase();
  if (isStrictSchemaFormat(normalized.responseFormat)) return true;
  if (hints.requested?.lane === "strict-json") return true;
  return /\b(json|json schema|schema-safe|structured output|tool arguments|function arguments|llm task|valid json)\b/i.test(text);
}

function inferActionClass(normalized, hints, features, classification, safetyGate) {
  const text = String(features.requestText || normalized.inputText || "").toLowerCase();
  if (safetyGate.triggered || hints.approvalRequired || classification.categoryId === "high_stakes") return "high_stakes";
  if (features.hasMultimodal) return "vision_analysis";
  if (hasExplicitStructuredOutputRequest(normalized, hints)) return "strict_json";
  if (/\b(spawn[_ -]?agent|sub-?agent|delegate|send_input|session coordination|coordinate agents|automation planning)\b/i.test(text)) {
    return "subagent_coordination";
  }
  if (/\b(browser|web[_ -]?search|web[_ -]?fetch|search the web|citations?|sources?|browse)\b/i.test(text)) {
    return classification.categoryId === "research" ? "research_synthesis" : "browser_research";
  }
  if (/\b(stack trace|failing test|compile|build failed|runtime error|exception|traceback|run this|execute|terminal output|logs?)\b/i.test(text)) {
    return "exec_loop";
  }
  if (/\b(apply_patch|patch|edit file|edit the file|refactor|rename|codebase|repo|repository|implement|fix bug)\b/i.test(text)) {
    return "code_edit";
  }
  if (classification.categoryId === "research" || hasDeepAnalysisSignals(text)) return "research_synthesis";
  if (/\b(reply|email|message|draft a reply|send a response)\b/i.test(text)) return "message_drafting";
  if (
    features.hasToolsDeclared ||
    features.toolMessages > 0 ||
    M27_WORKHORSE_CATEGORIES.has(classification.categoryId) ||
    /\b(project|task|ticket|issue|plan|roadmap|workflow|next step)\b/i.test(text)
  ) {
    return "active_session";
  }
  return "casual_chat";
}

function collectRequestedOptionalFields(normalized) {
  const optional = {
    temperature: normalized.body?.temperature,
    top_p: normalized.body?.top_p,
    top_k: normalized.body?.top_k,
    min_p: normalized.body?.min_p,
    presence_penalty: normalized.body?.presence_penalty,
    frequency_penalty: normalized.body?.frequency_penalty,
    repetition_penalty: normalized.body?.repetition_penalty,
    seed: normalized.body?.seed,
    stop: normalized.body?.stop,
    logit_bias: normalized.body?.logit_bias,
    logprobs: normalized.body?.logprobs,
    top_logprobs: normalized.body?.top_logprobs,
    parallel_tool_calls: normalized.body?.parallel_tool_calls,
    structured_outputs: normalized.body?.structured_outputs,
    include_reasoning: normalized.body?.include_reasoning,
    reasoning: normalized.reasoning || normalized.body?.reasoning,
    reasoning_effort: normalized.body?.reasoning_effort,
    verbosity: normalized.body?.verbosity
  };
  return Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined));
}

function sanitizeOptionalPayload(candidate, optionalFields, { minimal = false } = {}) {
  const supported = new Set(modelEntryForKey(candidate.key)?.supportedParameters || []);
  const sanitized = {};
  for (const [field, value] of Object.entries(optionalFields || {})) {
    if (value === undefined) continue;
    if (!supported.has(field)) continue;
    if (minimal && ["reasoning", "include_reasoning", "verbosity", "logprobs", "top_logprobs", "parallel_tool_calls"].includes(field)) {
      continue;
    }
    sanitized[field] = value;
  }
  return sanitized;
}

function canUseResponsesChatFallback(normalized) {
  return normalized.api === "responses" && !normalized.stream && Array.isArray(normalized.messages) && normalized.messages.length > 0;
}

function summarizeReasoningContinuity(normalized, modelKey, primaryApi) {
  const requested =
    Boolean(normalized.reasoning) ||
    (Array.isArray(normalized.responsesInput) && normalized.responsesInput.some((item) => item?.type === "reasoning"));
  const supported = Boolean(modelEntryForKey(modelKey)?.supportsReasoningPreservation);
  const preserved = requested && supported && primaryApi === "responses";
  return {
    requested,
    supported,
    preserved,
    via_api: primaryApi
  };
}

function createRuntime(config) {
  const HIGH_STAKES_POLICY_PROMPT = [
    "[ASTROLABE_HIGH_STAKES_POLICY]",
    "This request is high-stakes or approval-sensitive.",
    "Do not take irreversible actions without explicit confirmation.",
    "Be precise, conservative, and clear about uncertainty."
  ].join(" ");

  const CLASSIFIER_PROMPT = [
    "You are Astrolabe's strict routing classifier.",
    "Return strict JSON only with keys: category, complexity, confidence, modifiers, reason, matched_signals, high_stakes.",
    'Allowed category values: "heartbeat","core_loop","retrieval","summarization","planning","orchestration","coding","research","creative","communication","high_stakes","reflection".',
    'Allowed complexity values: "simple","standard","complex","critical".',
    "Allowed modifiers: multimodal, tool_present, needs_strict_schema, exec_loop, browser_research, code_edit, subagent_coordination, long_context, cacheable, approval_required, price_sensitive, untrusted_content.",
    "confidence must be 1-5."
  ].join("\n");

  const VERIFIER_PROMPTS = {
    basic: "Return strict JSON only with keys score and reason. Score 1-5 for whether the answer is complete and on-topic.",
    tool_schema:
      "Return strict JSON only with keys score and reason. Score 1-5 for whether the answer or tool calls look structurally valid and schema-safe.",
    safe:
      "Return strict JSON only with keys score and reason. Score 1-5 for whether the answer is complete, conservative, and safe for a high-stakes request."
  };

  function applyRoutingProfile(complexity, categoryId) {
    if (config.ROUTING_PROFILE === "quality") return shiftComplexity(complexity, 1);
    if (config.ROUTING_PROFILE === "balanced") return complexity;
    const category = CATEGORY_BY_ID.get(categoryId);
    if (!category) return complexity;
    return riskRank(category.injectionRisk) <= 2 ? shiftComplexity(complexity, -1) : complexity;
  }

  function classifyRequestedModel(requestedModel) {
    const value = String(requestedModel || "").trim();
    if (!value) return { type: "virtual", lane: "auto", requestedModel: "astrolabe/auto" };
    if (VIRTUAL_MODEL_MANIFEST[value]) return { type: "virtual", lane: value.split("/")[1], requestedModel: value };
    const resolvedAlias = resolveModelAlias(value);
    if (modelEntryForKey(resolvedAlias)) {
      return {
        type: "raw",
        requestedModel: value,
        modelKey: resolvedAlias,
        modelId: modelIdForKey(resolvedAlias)
      };
    }
    const keyFromId = resolveModelKeyFromId(value);
    if (keyFromId) {
      return {
        type: "raw",
        requestedModel: value,
        modelKey: keyFromId,
        modelId: modelIdForKey(keyFromId)
      };
    }
    return { type: "passthrough", requestedModel: value, modelId: value };
  }

  function inferRouteHints(normalized) {
    const metadata = normalized.metadata && typeof normalized.metadata === "object" ? normalized.metadata : {};
    const astrolabeMeta = metadata.astrolabe && typeof metadata.astrolabe === "object" ? metadata.astrolabe : {};
    const requested = classifyRequestedModel(normalized.requestedModel);
    const hintedCostMode = String(astrolabeMeta.cost_mode || metadata.cost_mode || "").trim().toLowerCase();
    const hintedLatencyMode = String(astrolabeMeta.latency_mode || metadata.latency_mode || "").trim().toLowerCase();
    return {
      requested,
      toolProfile: String(astrolabeMeta.tool_profile || metadata.tool_profile || "").trim().toLowerCase() || "default",
      untrustedContent: Boolean(astrolabeMeta.untrusted_content || metadata.untrusted_content),
      approvalRequired: Boolean(astrolabeMeta.approval_required || metadata.approval_required),
      trustBoundary: String(astrolabeMeta.trust_boundary || metadata.trust_boundary || "").trim().toLowerCase() || "default",
      costMode: hintedCostMode === "strict" ? "strict" : hintedCostMode === "cheap" ? "strict" : "default",
      latencyMode: hintedLatencyMode === "fast" ? "fast" : "default"
    };
  }

  function heuristicCategoryFallback(text, features, safetyGate, hints = {}) {
    const normalized = String(text || "").toLowerCase();
    if (safetyGate.triggered) return "high_stakes";
    if (features.hasMultimodal) return "summarization";
    if (/\b(code|debug|stack trace|refactor|test|function|typescript|javascript|python|repo|patch)\b/i.test(normalized)) {
      return "coding";
    }
    if (features.hasToolsDeclared || /\b(tool|browser|shell|web fetch|call the .* tool)\b/i.test(normalized)) {
      if (/\b(plan|workflow|coordinate|sequence|multi-step|automate)\b/i.test(normalized)) return "orchestration";
      return "core_loop";
    }
    if (/\b(research|compare|benchmark|trade[- ]off|sources?|citations?|analyze)\b/i.test(normalized)) return "research";
    if (/\b(plan|schedule|roadmap|checklist|steps|milestones?)\b/i.test(normalized)) return "planning";
    if (/\b(summarize|extract|receipt|invoice|key points|digest)\b/i.test(normalized)) return "summarization";
    if (/\b(find|lookup|search|retrieve|calendar|email|weather)\b/i.test(normalized)) return "retrieval";
    if (/\b(reply|email|message|draft|respond)\b/i.test(normalized)) return "communication";
    if (/\b(brainstorm|story|poem|creative|copy)\b/i.test(normalized)) return "creative";
    if (/\b(reflect|why did|improve|self-check|postmortem|retrospective)\b/i.test(normalized)) return "reflection";
    if (isOnboardingLikeRequest(text)) return "communication";
    const requested = hints.requested || {};
    if (requested.lane && requested.type === "virtual") {
      if (requested.lane === "coding") return "coding";
      if (requested.lane === "research") return "research";
      if (requested.lane === "vision") return "summarization";
      if (requested.lane === "safe") return "high_stakes";
      if (requested.lane === "strict-json") return "core_loop";
      if (requested.lane === "cheap") return "communication";
    }
    return "communication";
  }

  function heuristicComplexity(text, features, safetyGate, hints, categoryId) {
    if (safetyGate.triggered || hints.approvalRequired) return "critical";
    if (features.hasMultimodal && features.approxTokens >= 16000) return "complex";
    if (features.approxTokens >= 12000) return "complex";
    if (features.approxTokens >= 2500 || features.messageCount >= 8) return "standard";
    if (features.hasToolsDeclared && TOOL_MUTATION_REGEX.test(text)) return "standard";
    if (M27_WORKHORSE_CATEGORIES.has(categoryId)) return "standard";
    return "simple";
  }

  function heuristicClassification(lastUserMessage, recentContext, features, safetyGate, hints = {}) {
    const combined = normalizeWhitespace(`${lastUserMessage}\n${recentContext}`);
    const categoryId = heuristicCategoryFallback(combined, features, safetyGate, hints);
    const complexity = heuristicComplexity(combined, features, safetyGate, hints, categoryId);
    const actionClass = inferActionClass(
      {
        api: "chat",
        inputText: combined,
        responseFormat: null,
        body: {},
        messages: []
      },
      hints,
      { ...features, requestText: combined },
      { categoryId, complexity },
      safetyGate
    );
    const modifiers = [];
    if (features.hasMultimodal) modifiers.push("multimodal");
    if (features.hasToolsDeclared || features.toolMessages > 0) modifiers.push("tool_present");
    if (actionClass === "strict_json") modifiers.push("needs_strict_schema");
    if (actionClass === "exec_loop") modifiers.push("exec_loop");
    if (actionClass === "browser_research") modifiers.push("browser_research");
    if (actionClass === "code_edit") modifiers.push("code_edit");
    if (actionClass === "subagent_coordination") modifiers.push("subagent_coordination");
    if (features.approxTokens >= 10000) modifiers.push("long_context");
    if (features.approxTokens >= 2500 || features.messageCount >= 6) modifiers.push("cacheable");
    if (hints.approvalRequired) modifiers.push("approval_required");
    if (hints.untrustedContent) modifiers.push("untrusted_content");
    if (hints.costMode === "strict") modifiers.push("price_sensitive");
    const category = CATEGORY_BY_ID.get(categoryId);
    return {
      categoryId,
      complexity,
      confidence: 2,
      modifiers,
      reason: `Heuristic fallback for ${category?.name || categoryId}.`,
      matchedSignals: collectMatchedSignals(combined, category?.classifierSignals || []),
      highStakes: categoryId === "high_stakes",
      actionClass,
      source: "heuristic"
    };
  }

  function isHighStakesConfirmed(req, body) {
    const token = config.HIGH_STAKES_CONFIRM_TOKEN;
    const matches = (value) => typeof value === "string" && value.trim().toLowerCase() === token;
    if (matches(req.headers["x-astrolabe-confirmed"])) return true;
    if (matches(body?.metadata?.astrolabe_confirmed)) return true;
    if (matches(body?.astrolabe_confirmed)) return true;
    return false;
  }

  function maybeInjectHighStakesPrompt(messages) {
    const alreadyPresent = messages.some((message) => safeText(message.content).includes("[ASTROLABE_HIGH_STAKES_POLICY]"));
    if (alreadyPresent) return messages;
    return [{ role: "system", content: HIGH_STAKES_POLICY_PROMPT }, ...messages];
  }

  function validateResponsesUrlParts(normalized) {
    if (normalized.api !== "responses") return;
    const urls = collectResponsesUrlParts(normalized.responsesInput);
    if (!urls.length) return;
    if (urls.length > config.RESPONSES_MAX_URL_PARTS) {
      const error = new Error("Too many URL parts in Responses input.");
      error.status = 400;
      error.code = "responses_too_many_url_parts";
      throw error;
    }
    const imageRules = config.RESPONSES_IMAGES_URL_ALLOWLIST.map(parseAllowlistEntry).filter(Boolean);
    const fileRules = config.RESPONSES_FILES_URL_ALLOWLIST.map(parseAllowlistEntry).filter(Boolean);
    for (const url of urls) {
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
      const rules = isImage ? imageRules : fileRules;
      if (!isUrlAllowed(url, rules)) {
        const error = new Error(`URL is not allowed by Astrolabe policy: ${url}`);
        error.status = 400;
        error.code = "responses_url_not_allowed";
        throw error;
      }
    }
  }

  async function callWithModelCandidates(builder, candidates, stream) {
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const result = await builder(candidate, stream);
        return { ...candidate, result };
      } catch (error) {
        lastError = error;
        if (!isRetryableModelError(error)) throw error;
      }
    }
    throw lastError || new Error("No model candidates available.");
  }

  async function classifyRequest(lastUserMessage, recentContext, features, safetyGate, hints) {
    const heuristic = heuristicClassification(lastUserMessage, recentContext, features, safetyGate, hints);
    if (config.FORCE_MODEL_ID) return heuristic;
    const classifierCandidates = buildCandidatesFromKeys(
      [config.CLASSIFIER_MODEL_KEY, "glm47Flash", "grok"],
      { multimodal: false }
    );
    if (!classifierCandidates.length) return heuristic;
    const prompt = [
      `Latest user message:\n${lastUserMessage || "(empty)"}`,
      `Recent context:\n${recentContext || "(empty)"}`,
      `Features: ${JSON.stringify(features)}`,
      `Hints: ${JSON.stringify({
        requested: hints.requested.requestedModel,
        untrustedContent: hints.untrustedContent,
        approvalRequired: hints.approvalRequired,
        toolProfile: hints.toolProfile
      })}`
    ].join("\n\n");
    try {
      const classified = await callWithModelCandidates(
        (candidate) =>
          callOpenRouterChat(
            {
              model: candidate.modelId,
              stream: false,
              temperature: 0,
              max_tokens: 180,
              messages: [
                { role: "system", content: CLASSIFIER_PROMPT },
                { role: "user", content: prompt }
              ]
            },
            config
          ),
        classifierCandidates,
        false
      );
      const raw = normalizeWhitespace(safeText(classified.result?.choices?.[0]?.message?.content));
      const parsed = parseClassifierOutput(raw);
      if (!parsed) return heuristic;
      return { ...parsed, source: classified.modelId };
    } catch {
      return heuristic;
    }
  }

  function collectRouteModifiers(normalized, hints, features, classification, safetyGate, actionClass) {
    const modifiers = new Set(
      (classification.modifiers || []).map((modifier) => {
        if (modifier === "tool_heavy") return "tool_present";
        if (modifier === "strict_json") return "needs_strict_schema";
        return modifier;
      })
    );
    if (features.hasMultimodal) modifiers.add("multimodal");
    if (features.hasToolsDeclared || features.toolMessages > 0) modifiers.add("tool_present");
    if (hasExplicitStructuredOutputRequest(normalized, hints) || actionClass === "strict_json") modifiers.add("needs_strict_schema");
    if (actionClass === "exec_loop") modifiers.add("exec_loop");
    if (actionClass === "browser_research" || actionClass === "research_synthesis") modifiers.add("browser_research");
    if (actionClass === "code_edit") modifiers.add("code_edit");
    if (actionClass === "subagent_coordination") modifiers.add("subagent_coordination");
    if (features.approxTokens >= 10000) modifiers.add("long_context");
    if (features.approxTokens >= 2500 || features.messageCount >= 6) modifiers.add("cacheable");
    if (hints.approvalRequired || safetyGate.actionLike) modifiers.add("approval_required");
    if (hints.untrustedContent) modifiers.add("untrusted_content");
    if (hints.costMode === "strict" || hints.requested.lane === "cheap") modifiers.add("price_sensitive");
    if (actionClass === "high_stakes") modifiers.add("high_stakes");
    return [...modifiers];
  }

  function chooseLane(normalized, routeIntent, hints = {}, modifiers = []) {
    const requested = hints.requested || {};
    if (requested.type === "virtual" && requested.lane && requested.lane !== "auto") return requested.lane;
    if (requested.type === "raw") return "pinned";
    if (routeIntent.categoryId === "high_stakes" || modifiers.includes("approval_required") || routeIntent.actionClass === "high_stakes") {
      return "safe";
    }
    if (modifiers.includes("multimodal")) return "vision";
    if (modifiers.includes("needs_strict_schema")) {
      return "strict-json";
    }
    if (
      routeIntent.categoryId === "research" ||
      routeIntent.actionClass === "research_synthesis" ||
      routeIntent.actionClass === "browser_research"
    ) {
      return "research";
    }
    if (
      routeIntent.categoryId === "coding" ||
      routeIntent.actionClass === "code_edit" ||
      routeIntent.actionClass === "exec_loop" ||
      routeIntent.actionClass === "subagent_coordination"
    ) {
      return "coding";
    }
    if (
      LOW_RISK_CATEGORIES.has(routeIntent.categoryId) &&
      routeIntent.adjustedComplexity === "simple" &&
      !modifiers.includes("tool_present") &&
      !modifiers.includes("multimodal")
    ) {
      return "cheap";
    }
    if (
      requested.lane === "cheap" ||
      (modifiers.includes("price_sensitive") && LOW_RISK_CATEGORIES.has(routeIntent.categoryId) && !modifiers.includes("needs_strict_schema"))
    ) {
      return "cheap";
    }
    return "auto";
  }

  function selectInitialModelForLane(lane, routeIntent, hints = {}, features = {}, modifiers = []) {
    const requested = hints.requested || {};
    if (requested.type === "raw") return requested.modelKey;
    if (config.FORCE_MODEL_ID) return resolveModelKeyFromId(config.FORCE_MODEL_ID) || null;
    if (lane === "safe") return "sonnet";
    if (lane === "vision") return features.approxTokens >= 18000 ? "qwen35Plus" : "kimiK25";
    if (lane === "research") {
      if (features.approxTokens >= 18000 || modifiers.includes("long_context") || features.hasMultimodal) return "qwen35Plus";
      if (routeIntent.adjustedComplexity === "complex" || routeIntent.adjustedComplexity === "critical") return "kimiThinking";
      return "m27";
    }
    if (lane === "strict-json") return "m27";
    if (lane === "coding") {
      if (routeIntent.adjustedComplexity === "simple" && hints.costMode === "strict") return "qwenCoderNext";
      if (modifiers.includes("needs_strict_schema") && routeIntent.adjustedComplexity !== "simple") return "glm5";
      return "m27";
    }
    if (lane === "cheap") {
      if (routeIntent.categoryId === "coding") return "qwenCoderNext";
      if (modifiers.includes("tool_present") || modifiers.includes("long_context")) return "grok";
      if (["heartbeat", "retrieval", "summarization"].includes(routeIntent.categoryId) && !features.hasToolsDeclared) {
        return "qwen35Flash";
      }
      return routeIntent.actionClass === "message_drafting" ? "grok" : "qwen35Flash";
    }
    if (modifiers.includes("multimodal")) return "kimiK25";
    if (routeIntent.categoryId === "high_stakes") return "sonnet";
    if (modifiers.includes("needs_strict_schema")) return "m27";
    if (routeIntent.actionClass === "casual_chat" || routeIntent.actionClass === "message_drafting") return "qwen35Flash";
    if (M27_WORKHORSE_CATEGORIES.has(routeIntent.categoryId)) return "m27";
    if (["retrieval", "summarization", "heartbeat"].includes(routeIntent.categoryId) && routeIntent.adjustedComplexity === "simple") {
      return "qwen35Flash";
    }
    if (routeIntent.adjustedComplexity === "simple") return "qwen35Flash";
    return "m27";
  }

  function applyCostGuardrails(routeDecision, routeIntent, requestText, features, modifiers = [], hints = {}) {
    if (routeDecision.label === "FORCED" || routeDecision.label === "PINNED") return routeDecision;
    const guarded = { ...routeDecision };
    const strictBudgetProfile = config.DEFAULT_PROFILE === "strict-budget" || hints.costMode === "strict";
    if (hints.untrustedContent && (features.hasToolsDeclared || features.toolMessages > 0)) {
      if (["grok", "dsCoder", "gpt5Nano", "gpt54Nano", "qwen35Flash", "qwenCoderNext", "m25"].includes(guarded.modelKey)) {
        guarded.modelKey = "m27";
        guarded.modelId = modelIdForKey("m27");
        guarded.label = "SAFETY_FLOOR";
      }
    }
    if (strictBudgetProfile && guarded.modelKey === "m27" && !modifiers.includes("multimodal") && !modifiers.includes("needs_strict_schema")) {
      if (LOW_RISK_CATEGORIES.has(routeIntent.categoryId) || routeIntent.categoryId === "planning") {
        guarded.modelKey = "m25";
        guarded.modelId = modelIdForKey("m25");
        guarded.label = "STRICT_BUDGET";
      }
    }
    if (config.DEFAULT_PROFILE === "max-capability" && guarded.modelKey === "m27" && routeIntent.adjustedComplexity === "critical") {
      guarded.modelKey = "sonnet";
      guarded.modelId = modelIdForKey("sonnet");
      guarded.label = "MAX_CAPABILITY";
    }
    if (isOnboardingLikeRequest(requestText) && !features.hasToolsDeclared && routeIntent.categoryId !== "high_stakes") {
      guarded.modelKey = hints.costMode === "strict" ? "grok" : "qwen35Flash";
      guarded.modelId = modelIdForKey(guarded.modelKey);
      guarded.label = guarded.modelKey === "grok" ? "BUDGET_GUARDRAIL" : "LOW_RISK_VALUE";
    }
    return guarded;
  }

  function resolveCategoryRoute(classification, hints, features, modifiers, safetyGate, actionClass) {
    const adjustedComplexity = applyRoutingProfile(classification.complexity, classification.categoryId);
    const routeIntent = {
      categoryId: classification.categoryId,
      complexity: classification.complexity,
      adjustedComplexity,
      actionClass
    };
    const lane = chooseLane(null, routeIntent, hints, modifiers);
    let modelKey = selectInitialModelForLane(lane, routeIntent, hints, features, modifiers);
    let label = "DEFAULT";
    if (config.FORCE_MODEL_ID) {
      const forcedKey = resolveModelKeyFromId(config.FORCE_MODEL_ID) || null;
      modelKey = forcedKey || null;
      label = "FORCED";
    } else if (hints.requested.type === "raw") {
      modelKey = hints.requested.modelKey;
      label = "PINNED";
    } else if (lane === "safe") {
      label = "SAFE";
    } else if (lane === "cheap") {
      label = "CHEAP";
    }
    const routeDecision = {
      ...routeIntent,
      lane,
      actionClass,
      modelKey,
      modelId: modelKey ? modelIdForKey(modelKey) : config.FORCE_MODEL_ID,
      label,
      rule: CATEGORY_BY_ID.get(classification.categoryId)?.name || classification.categoryId,
      injectionRisk: CATEGORY_BY_ID.get(classification.categoryId)?.injectionRisk || "UNKNOWN",
      safetyGateTriggered: safetyGate.triggered
    };
    return applyCostGuardrails(routeDecision, routeIntent, features.requestText || "", features, modifiers, hints);
  }

  function buildCandidatesForRoute(routeDecision, features, modifiers = [], hints = {}) {
    if (routeDecision.label === "FORCED" && config.FORCE_MODEL_ID) {
      return [{ key: resolveModelKeyFromId(config.FORCE_MODEL_ID) || "forced", modelId: config.FORCE_MODEL_ID }];
    }
    if (routeDecision.label === "PINNED") {
      const fallbackKeys = MODEL_FALLBACKS[routeDecision.modelKey] || [];
      return buildCandidatesFromKeys([routeDecision.modelKey, ...fallbackKeys], { multimodal: modifiers.includes("multimodal") });
    }
    const laneConfig = LANE_MANIFEST[routeDecision.lane] || LANE_MANIFEST.auto;
    const keys = [
      routeDecision.modelKey,
      ...(laneConfig?.defaultCandidates || []),
      ...(laneConfig?.fallbackCandidates || []),
      ...(MODEL_FALLBACKS[routeDecision.modelKey] || [])
    ];
    let candidates = buildCandidatesFromKeys(keys, { multimodal: modifiers.includes("multimodal") });
    if (hints.untrustedContent && (features.hasToolsDeclared || features.toolMessages > 0)) {
      candidates = candidates.filter(
        (candidate) => !["grok", "dsCoder", "gpt5Nano", "gpt54Nano", "qwen35Flash", "qwenCoderNext", "m25"].includes(candidate.key)
      );
    }
    if (!["research", "vision"].includes(routeDecision.lane)) {
      candidates = candidates.filter((candidate) => !modelEntryForKey(candidate.key)?.preview);
    }
    return candidates;
  }

  function determineVerificationPolicy(routeDecision, modifiers) {
    if (routeDecision.lane === "safe" || routeDecision.categoryId === "high_stakes") return "safe";
    if (modifiers.includes("needs_strict_schema") || routeDecision.actionClass === "strict_json") return "tool_schema";
    return "basic";
  }

  function shouldEscalateFromSelfCheck(score, routeDecision = {}) {
    if (routeDecision.label === "FORCED" || routeDecision.label === "PINNED") return false;
    if (score >= 4) return false;
    if (routeDecision.lane === "safe" || routeDecision.categoryId === "high_stakes") return true;
    if (score <= 1) return true;
    if (routeDecision.lane === "strict-json") return false;
    if (routeDecision.lane === "research" && routeDecision.adjustedComplexity === "critical" && score <= 2) return true;
    return false;
  }

  function buildEscalationTarget(modelKey, score, routeDecision = {}, features = {}, modifiers = []) {
    if (!shouldEscalateFromSelfCheck(score, routeDecision)) return null;
    if (modelKey === "opus") return null;
    if (routeDecision.lane === "safe") return modelKey === "sonnet" ? "opus" : "sonnet";
    if (modelKey === "m25") return "m27";
    if (modelKey === "gpt5Nano") return "glm47Flash";
    if (modelKey === "qwen35Flash" || modelKey === "grok" || modelKey === "dsCoder" || modelKey === "qwenCoderNext") return "m27";
    if (modelKey === "m27") {
      if (routeDecision.lane === "vision" || modifiers.includes("multimodal")) {
        return features.approxTokens >= 18000 ? "qwen35Plus" : "kimiK25";
      }
      if (routeDecision.lane === "research" || routeDecision.categoryId === "research") {
        return features.approxTokens >= 18000 || modifiers.includes("long_context") ? "qwen35Plus" : "kimiThinking";
      }
      if (routeDecision.lane === "coding" && score <= 1) return "sonnet";
      if (routeDecision.adjustedComplexity === "critical") return "sonnet";
      return null;
    }
    if (modelKey === "glm47Flash") return "glm5";
    if (modelKey === "glm5") return routeDecision.lane === "strict-json" ? "gpt54Mini" : "sonnet";
    if (modelKey === "gpt54Mini") return "gpt54";
    if (modelKey === "gpt54") return "sonnet";
    if (modelKey === "kimiK25" || modelKey === "kimiThinking") return "sonnet";
    if (modelKey === "qwen35Plus") return "sonnet";
    if (modelKey === "sonnet") return "opus";
    return ESCALATION_PATH[modelKey] || "m27";
  }

  function buildProviderOverrides(routeDecision, modifiers = [], hints = {}) {
    const provider = {
      allow_fallbacks: true,
      require_parameters: Boolean(modifiers.includes("needs_strict_schema"))
    };
    provider.sort = hints.latencyMode === "fast" ? "latency" : hints.costMode === "strict" || routeDecision.lane === "cheap" ? "price" : "throughput";
    if (hints.trustBoundary === "private" || hints.trustBoundary === "sensitive") provider.zdr = true;
    return provider;
  }

  function buildPlugins(normalized, routeDecision, modifiers) {
    const plugins = [];
    if (!normalized.stream && (normalized.responseFormat || modifiers.includes("needs_strict_schema"))) {
      plugins.push({ id: "response-healing" });
    }
    if (modifiers.includes("long_context") && routeDecision.lane === "research") plugins.push({ id: "context-compression" });
    return plugins;
  }

  function maybeExactoModelId(modelId, modelKey, modifiers) {
    if ((modelKey === "glm5" || modelKey === "glm47Flash") && modifiers.includes("needs_strict_schema")) {
      return `${modelId}:exacto`;
    }
    return modelId;
  }

  function buildChatPayload(normalized, candidate, routeDecision, modifiers, hints, options = {}) {
    const optional = sanitizeOptionalPayload(candidate, collectRequestedOptionalFields(normalized), options);
    const payload = {
      model: maybeExactoModelId(candidate.modelId, candidate.key, modifiers),
      messages: normalized.messages,
      stream: normalized.stream,
      provider: buildProviderOverrides(routeDecision, modifiers, hints),
      ...optional
    };
    if (normalized.tools?.length && (modelEntryForKey(candidate.key)?.supportedParameters || []).includes("tools")) payload.tools = normalized.tools;
    if (normalized.toolChoice != null && (modelEntryForKey(candidate.key)?.supportedParameters || []).includes("tool_choice")) {
      payload.tool_choice = normalized.toolChoice;
    }
    if (isStrictSchemaFormat(normalized.responseFormat) && (modelEntryForKey(candidate.key)?.supportedParameters || []).includes("response_format")) {
      payload.response_format = normalized.responseFormat;
    }
    if (normalized.maxOutputTokens != null && (modelEntryForKey(candidate.key)?.supportedParameters || []).includes("max_tokens")) {
      payload.max_tokens = normalized.maxOutputTokens;
    }
    const plugins = buildPlugins(normalized, routeDecision, modifiers);
    if (plugins.length && !options.minimal) payload.plugins = plugins;
    return payload;
  }

  function buildResponsesPayload(normalized, candidate, routeDecision, modifiers, hints, options = {}) {
    const supports = new Set(modelEntryForKey(candidate.key)?.supportedParameters || []);
    const optional = sanitizeOptionalPayload(candidate, collectRequestedOptionalFields(normalized), options);
    const payload = {
      model: maybeExactoModelId(candidate.modelId, candidate.key, modifiers),
      input: normalized.responsesInput ?? normalized.messages,
      instructions: normalized.instructions || undefined,
      stream: normalized.stream,
      metadata: normalized.metadata,
      provider: buildProviderOverrides(routeDecision, modifiers, hints),
      ...optional
    };
    if (normalized.tools?.length && supports.has("tools")) payload.tools = normalized.tools;
    if (normalized.toolChoice != null && supports.has("tool_choice")) payload.tool_choice = normalized.toolChoice;
    if (normalized.reasoning && supports.has("reasoning")) payload.reasoning = normalized.reasoning;
    if (!options.minimal) payload.text = normalized.text || (normalized.responseFormat ? { format: normalized.responseFormat } : undefined);
    if (isStrictSchemaFormat(normalized.responseFormat) && supports.has("response_format")) payload.response_format = normalized.responseFormat;
    if (normalized.maxOutputTokens != null && supports.has("max_tokens")) payload.max_output_tokens = normalized.maxOutputTokens;
    const plugins = buildPlugins(normalized, routeDecision, modifiers);
    if (plugins.length && !options.minimal) payload.plugins = plugins;
    return payload;
  }

  function extractChatAssistantMessage(response) {
    return response?.choices?.[0]?.message || null;
  }

  function extractResponsesPrimaryOutput(response) {
    if (!response || !Array.isArray(response.output)) return null;
    return response.output.find((item) => item?.type === "message") || response.output[0] || null;
  }

  function extractResponsesOutputText(response) {
    const primary = extractResponsesPrimaryOutput(response);
    if (!primary) return "";
    if (typeof primary.text === "string") return primary.text;
    return safeText(primary.content || primary.output_text || primary.text || "");
  }

  function extractToolCalls(result, api) {
    if (api === "chat") {
      return extractChatAssistantMessage(result)?.tool_calls || [];
    }
    const output = Array.isArray(result?.output) ? result.output : [];
    const toolCalls = [];
    for (const item of output) {
      if (item?.type === "function_call") {
        toolCalls.push({
          id: item.call_id || item.id,
          type: "function",
          function: {
            name: item.name || item.function?.name || "tool",
            arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
          }
        });
      }
      if (item?.type === "message" && Array.isArray(item.tool_calls)) toolCalls.push(...item.tool_calls);
    }
    return toolCalls;
  }

  function validateStructuredOutput(result, normalized) {
    if (!normalized.responseFormat) return { ok: true };
    const text = normalized.api === "chat" ? safeText(extractChatAssistantMessage(result)?.content) : extractResponsesOutputText(result);
    if (!text) return { ok: false, reason: "Structured output request returned empty text." };
    if (normalized.responseFormat.type === "json_object" || normalized.responseFormat.type === "json_schema") {
      const parsed = tryParseJson(text);
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, reason: "Expected JSON output." };
      }
    }
    return { ok: true };
  }

  function validateToolCallArguments(toolCalls) {
    if (!toolCalls.length) return { ok: true };
    for (const toolCall of toolCalls) {
      const toolName = String(toolCall?.function?.name || "tool");
      const args = toolCall?.function?.arguments;
      if (typeof args !== "string" || !args.trim()) {
        return { ok: false, reason: `Tool call ${toolName} did not include JSON arguments.` };
      }
      const parsed = tryParseJson(args);
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, reason: `Tool call ${toolName} arguments were not valid JSON.` };
      }
    }
    return { ok: true };
  }

  function validateExecutionArtifacts(result, normalized, api, modifiers = []) {
    const structureCheck = validateStructuredOutput(result, normalized);
    if (!structureCheck.ok) return structureCheck;
    if (modifiers.includes("needs_strict_schema")) {
      const toolCallCheck = validateToolCallArguments(extractToolCalls(result, api));
      if (!toolCallCheck.ok) return toolCallCheck;
    }
    return { ok: true };
  }

  function buildValidationRecoveryKeys(modelKey, routeDecision, modifiers = []) {
    if (!modifiers.includes("needs_strict_schema")) return [];
    if (routeDecision.label === "FORCED" || routeDecision.label === "PINNED") return [];
    if (modelKey === "m27") return ["glm47Flash", "glm5", "gpt54Mini", "gpt54", "sonnet"];
    if (modelKey === "glm47Flash") return ["glm5", "gpt54Mini", "gpt54", "sonnet"];
    if (modelKey === "glm5") return ["gpt54Mini", "gpt54", "sonnet"];
    if (modelKey === "gpt54Mini") return ["gpt54", "sonnet"];
    if (modelKey === "gpt54") return ["sonnet"];
    if (modelKey === "sonnet") return ["opus"];
    return [];
  }

  function classifyToolPolicy(normalized, toolCalls, hints) {
    if (!toolCalls.length) return { status: "allow", reason: "No outbound tool calls." };
    if (hints.toolProfile === "blocked") return { status: "blocked", reason: "Tool profile blocks all tool calls." };
    for (const toolCall of toolCalls) {
      const toolName = String(toolCall?.function?.name || "");
      const args = String(toolCall?.function?.arguments || "");
      const combined = `${toolName} ${args}`;
      if (hints.toolProfile === "read-only" && TOOL_MUTATION_REGEX.test(combined)) {
        return { status: "blocked", reason: `Read-only tool profile blocked ${toolName}.` };
      }
      if (TOOL_APPROVAL_REGEX.test(combined) || hints.approvalRequired) {
        return { status: "approval_required", reason: `Tool call ${toolName} requires confirmation.` };
      }
      if (hints.untrustedContent && TOOL_BLOCK_REGEX.test(combined)) {
        return { status: "approval_required", reason: `Untrusted-content route requires confirmation for ${toolName}.` };
      }
    }
    return { status: "allow", reason: "Tool calls passed policy checks." };
  }

  async function runVerifier(normalized, routeDecision, modifiers, lastUserMessage, answerText) {
    const verifierPolicy = determineVerificationPolicy(routeDecision, modifiers);
    const verifierCandidates = buildCandidatesFromKeys(
      [
        verifierPolicy === "safe" ? "gpt54" : config.SELF_CHECK_MODEL_KEY,
        "glm47Flash",
        "grok"
      ],
      { multimodal: false }
    );
    if (!verifierCandidates.length) {
      return {
        score: 4,
        reason: "Verifier skipped because no verifier candidates were available.",
        source: "fallback"
      };
    }
    try {
      const checked = await callWithModelCandidates(
        (candidate) =>
          callOpenRouterChat(
            {
              model: candidate.modelId,
              stream: false,
              temperature: 0,
              max_tokens: 120,
              messages: [
                { role: "system", content: VERIFIER_PROMPTS[verifierPolicy] },
                {
                  role: "user",
                  content: `User request:\n${lastUserMessage || "(empty)"}\n\nAssistant answer:\n${answerText || "(empty)"}`
                }
              ]
            },
            config
          ),
        verifierCandidates,
        false
      );
      const raw = normalizeWhitespace(safeText(checked.result?.choices?.[0]?.message?.content));
      return { ...parseVerifierOutput(raw), source: checked.modelId, policy: verifierPolicy };
    } catch (error) {
      return {
        score: 4,
        reason: `Verifier skipped on error: ${String(error.message || "unknown").slice(0, 120)}`,
        source: "fallback",
        policy: verifierPolicy
      };
    }
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
        type: status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "server_error" : "invalid_request_error",
        code: error?.code || error?.upstream?.error?.code || null
      }
    };
  }

  function buildAstrolabeMetadata(routeDecision, classification, modifiers, candidates, execution, verifier, toolPolicy) {
    return {
      category: routeDecision.categoryId,
      action_class: routeDecision.actionClass,
      complexity: classification.complexity,
      adjusted_complexity: routeDecision.adjustedComplexity,
      lane: routeDecision.lane,
      route_label: routeDecision.label,
      modifiers,
      candidate_models: candidates.map((candidate) => candidate.modelId),
      chosen_model: execution.initialModelId,
      final_model: execution.finalModelId,
      upstream_api: execution.upstreamApi,
      provider_policy: execution.providerPolicy,
      cache_policy: modifiers.includes("cacheable") ? "cache-friendly" : "default",
      reasoning_continuity: execution.reasoningContinuity,
      verifier_result: verifier
        ? {
            policy: verifier.policy || determineVerificationPolicy(routeDecision, modifiers),
            score: verifier.score,
            reason: verifier.reason
          }
        : null,
      tool_policy: toolPolicy,
      retry_path: execution.retryPath,
      estimated_cost: execution.cost
    };
  }

  function setRoutingHeaders(res, metadata) {
    const headers = {
      "x-astrolabe-category": metadata.categoryId,
      "x-astrolabe-action-class": metadata.actionClass,
      "x-astrolabe-complexity": metadata.complexity,
      "x-astrolabe-adjusted-complexity": metadata.adjustedComplexity,
      "x-astrolabe-lane": metadata.lane,
      "x-astrolabe-initial-model": metadata.initialModelId,
      "x-astrolabe-final-model": metadata.finalModelId,
      "x-astrolabe-route-label": metadata.routeLabel,
      "x-astrolabe-upstream-api": metadata.upstreamApi,
      "x-astrolabe-escalated": String(Boolean(metadata.escalated)),
      "x-astrolabe-confidence-score": metadata.confidenceScore == null ? "" : String(metadata.confidenceScore),
      "x-astrolabe-low-confidence": String(Boolean(metadata.lowConfidence)),
      "x-astrolabe-safety-gate": String(Boolean(metadata.safetyGateTriggered))
    };
    for (const [name, value] of Object.entries(headers)) {
      if (value == null || value === "") continue;
      res.setHeader(name, String(value));
    }
  }

  function attachChatMetadata(response, metadata) {
    return {
      ...response,
      astrolabe: metadata
    };
  }

  function chatResponseToResponseResource(response, normalized, metadata) {
    const assistant = extractChatAssistantMessage(response) || { role: "assistant", content: "" };
    const text = safeText(assistant.content);
    const output = [];
    output.push({
      type: "message",
      role: "assistant",
      content: text ? [{ type: "output_text", text }] : []
    });
    for (const toolCall of assistant.tool_calls || []) {
      output.push({
        type: "function_call",
        id: toolCall.id,
        call_id: toolCall.id,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments
      });
    }
    return {
      id: response.id || `resp_${Date.now()}`,
      object: "response",
      created: response.created || Math.floor(Date.now() / 1000),
      model: response.model || metadata.final_model,
      status: "completed",
      output,
      usage: {
        input_tokens: Number(response.usage?.prompt_tokens || 0),
        output_tokens: Number(response.usage?.completion_tokens || 0),
        total_tokens: Number(response.usage?.total_tokens || 0)
      },
      metadata: {
        ...(normalized.metadata || {}),
        astrolabe: metadata
      }
    };
  }

  function finalizeExecutionBody(normalized, result, astrolabeMeta) {
    if (normalized.api === "responses") {
      const body =
        result?.object === "response"
          ? {
              ...result,
              metadata: {
                ...(result.metadata || {}),
                astrolabe: astrolabeMeta
              }
            }
          : chatResponseToResponseResource(result, normalized, astrolabeMeta);
      return body;
    }
    return attachChatMetadata(result, astrolabeMeta);
  }

  async function executeNormalizedRequest(req, normalized) {
    const lastUserMessage = extractLastUserMessage(normalized.messages);
    const recentContext = buildRecentContext(normalized.messages, config);
    const features = {
      ...extractConversationFeatures(normalized.messages, normalized.body),
      requestText: lastUserMessage || normalized.inputText
    };
    const hints = inferRouteHints(normalized);
    const safetyText = `${lastUserMessage}\n${recentContext}`;
    const safetyGate = config.ENABLE_SAFETY_GATE ? detectSafetyGate(safetyText) : { triggered: false, matchedSignals: [], actionLike: false };
    const confirmationRequired =
      safetyGate.triggered &&
      config.HIGH_STAKES_CONFIRM_MODE === "strict" &&
      !isHighStakesConfirmed(req, normalized.body);
    if (confirmationRequired) {
      const error = new Error(
        `High-stakes request blocked pending confirmation. Resend with header x-astrolabe-confirmed: ${config.HIGH_STAKES_CONFIRM_TOKEN}.`
      );
      error.status = 409;
      error.code = "high_stakes_confirmation_required";
      throw error;
    }
    validateResponsesUrlParts(normalized);
    const classification = await classifyRequest(lastUserMessage, recentContext, features, safetyGate, hints);
    const actionClass = inferActionClass(normalized, hints, features, classification, safetyGate);
    const modifiers = collectRouteModifiers(normalized, hints, features, classification, safetyGate, actionClass);
    const routeDecision = resolveCategoryRoute(classification, hints, features, modifiers, safetyGate, actionClass);
    const candidates = buildCandidatesForRoute(routeDecision, features, modifiers, hints);
    const outboundMessages =
      safetyGate.triggered && config.HIGH_STAKES_CONFIRM_MODE === "prompt" && normalized.api === "chat"
        ? maybeInjectHighStakesPrompt(normalized.messages)
        : normalized.messages;
    const executionRetryPath = [];

    const invokeCandidate = async (candidate, api, minimal = false) => {
      executionRetryPath.push(`${api}${minimal ? ":minimal" : ""}:${candidate.modelId}`);
      if (api === "responses") {
        const payload = buildResponsesPayload(
          { ...normalized, messages: outboundMessages },
          candidate,
          routeDecision,
          modifiers,
          hints,
          { minimal }
        );
        return normalized.stream ? callOpenRouterResponsesStream(payload, config) : callOpenRouterResponses(payload, config);
      }
      const payload = buildChatPayload(
        { ...normalized, messages: outboundMessages },
        candidate,
        routeDecision,
        modifiers,
        hints,
        { minimal }
      );
      return normalized.stream ? callOpenRouterChatStream(payload, config) : callOpenRouterChat(payload, config);
    };

    const executeSingleCandidate = async (candidate, preferredApi = normalized.api) => {
      let lastError = null;
      if (preferredApi === "responses") {
        try {
          return { api: "responses", result: await invokeCandidate(candidate, "responses", false) };
        } catch (error) {
          lastError = error;
          if (!normalized.stream && isRetryableModelError(error)) {
            try {
              return { api: "responses", result: await invokeCandidate(candidate, "responses", true) };
            } catch (minimalError) {
              lastError = minimalError;
            }
          }
          if (canUseResponsesChatFallback(normalized) && isRetryableModelError(lastError)) {
            try {
              return { api: "chat", result: await invokeCandidate(candidate, "chat", true) };
            } catch (chatError) {
              lastError = chatError;
            }
          }
          throw lastError;
        }
      }
      try {
        return { api: "chat", result: await invokeCandidate(candidate, "chat", false) };
      } catch (error) {
        if (!normalized.stream && isRetryableModelError(error)) {
          return { api: "chat", result: await invokeCandidate(candidate, "chat", true) };
        }
        throw error;
      }
    };

    const executeAcrossCandidates = async (candidateList, preferredApi = normalized.api) => {
      let lastError = null;
      for (const candidate of candidateList) {
        try {
          const executed = await executeSingleCandidate(candidate, preferredApi);
          return {
            ...candidate,
            api: executed.api,
            result: executed.result
          };
        } catch (error) {
          lastError = error;
          if (!isRetryableModelError(error)) throw error;
        }
      }
      throw lastError || new Error("No model candidates available.");
    };

    const execution = await executeAcrossCandidates(candidates, normalized.api);
    let primaryApi = execution.api;

    const initialModelId = execution.modelId;
    let finalModelId = execution.modelId;
    let finalModelKey = execution.key;
    let finalResult = execution.result;
    let verifier = null;
    let escalated = false;
    let lowConfidence = false;
    let toolPolicy = { status: "allow", reason: "Streaming responses skip post-verification." };

    if (!normalized.stream && routeDecision.label !== "FORCED") {
      const ensureValidatedResult = async () => {
        const initialValidation = validateExecutionArtifacts(
          finalResult,
          normalized,
          primaryApi === "responses" ? "responses" : "chat",
          modifiers
        );
        if (initialValidation.ok) return;

        const recoveryKeys = buildValidationRecoveryKeys(finalModelKey, routeDecision, modifiers);
        if (!recoveryKeys.length) {
          const error = new Error(initialValidation.reason);
          error.status = 502;
          error.code = "structured_output_invalid";
          throw error;
        }

        const recoveryCandidates = buildCandidatesFromKeys(recoveryKeys, {
          multimodal: modifiers.includes("multimodal")
        });
        let lastFailure = initialValidation;
        for (const candidate of recoveryCandidates) {
          const recovered = await executeSingleCandidate(candidate, primaryApi);
          const validation = validateExecutionArtifacts(
            recovered.result,
            normalized,
            recovered.api === "responses" ? "responses" : "chat",
            modifiers
          );
          if (validation.ok) {
            escalated = true;
            finalResult = recovered.result;
            finalModelId = candidate.modelId;
            finalModelKey = candidate.key;
            primaryApi = recovered.api;
            return;
          }
          lastFailure = validation;
        }

        const error = new Error(lastFailure.reason || "Structured output validation failed.");
        error.status = 502;
        error.code = "structured_output_invalid";
        throw error;
      };

      await ensureValidatedResult();

      const answerText =
        normalized.api === "responses" && primaryApi === "responses"
          ? extractResponsesOutputText(finalResult)
          : safeText(extractChatAssistantMessage(finalResult)?.content);
      verifier = await runVerifier(normalized, routeDecision, modifiers, lastUserMessage, answerText);
      const target = buildEscalationTarget(finalModelKey, verifier.score, routeDecision, features, modifiers);
      if (target && target !== finalModelKey) {
        escalated = true;
        const escalationCandidates = buildCandidatesFromKeys(
          [target, ...(MODEL_FALLBACKS[target] || [])],
          { multimodal: modifiers.includes("multimodal") }
        );
        const escalatedExecution = await executeAcrossCandidates(escalationCandidates, primaryApi);
        finalResult = escalatedExecution.result;
        finalModelId = escalatedExecution.modelId;
        finalModelKey = escalatedExecution.key;
        primaryApi = escalatedExecution.api;
        await ensureValidatedResult();
        const escalatedAnswerText =
          normalized.api === "responses" && primaryApi === "responses"
            ? extractResponsesOutputText(finalResult)
            : safeText(extractChatAssistantMessage(finalResult)?.content);
        verifier = await runVerifier(normalized, routeDecision, modifiers, lastUserMessage, escalatedAnswerText);
      }
      lowConfidence = verifier.score <= (routeDecision.lane === "safe" ? 4 : 3);
      toolPolicy = classifyToolPolicy(normalized, extractToolCalls(finalResult, primaryApi === "responses" ? "responses" : "chat"), hints);
      if (toolPolicy.status === "blocked") {
        const error = new Error(toolPolicy.reason);
        error.status = 409;
        error.code = "tool_call_blocked";
        throw error;
      }
      if (toolPolicy.status === "approval_required" && !isHighStakesConfirmed(req, normalized.body)) {
        const error = new Error(toolPolicy.reason);
        error.status = 409;
        error.code = "tool_call_confirmation_required";
        throw error;
      }
    }

    return {
      classification,
      modifiers,
      routeDecision,
      initialModelId,
      finalModelId,
      finalResult,
      primaryApi,
      escalated,
      verifier,
      lowConfidence,
      toolPolicy,
      providerPolicy: buildProviderOverrides(routeDecision, modifiers, hints),
      retryPath: executionRetryPath,
      cost: estimateCost(finalModelId, finalResult?.usage),
      reasoningContinuity: summarizeReasoningContinuity(normalized, finalModelKey, primaryApi)
    };
  }

  async function executeChatRequest(req, res) {
    const normalized = normalizeChatRequest(req.body || {});
    const execution = await executeNormalizedRequest(req, normalized);
    const metadata = buildAstrolabeMetadata(
      execution.routeDecision,
      execution.classification,
      execution.modifiers,
      buildCandidatesForRoute(execution.routeDecision, extractConversationFeatures(normalized.messages, normalized.body), execution.modifiers, inferRouteHints(normalized)),
      {
        initialModelId: execution.initialModelId,
        finalModelId: execution.finalModelId,
        upstreamApi: execution.primaryApi,
        providerPolicy: execution.providerPolicy,
        retryPath: execution.retryPath,
        reasoningContinuity: execution.reasoningContinuity,
        cost: execution.cost
      },
      execution.verifier,
      execution.toolPolicy
    );
    setRoutingHeaders(res, {
      categoryId: execution.routeDecision.categoryId,
      actionClass: execution.routeDecision.actionClass,
      complexity: execution.classification.complexity,
      adjustedComplexity: execution.routeDecision.adjustedComplexity,
      lane: execution.routeDecision.lane,
      initialModelId: execution.initialModelId,
      finalModelId: execution.finalModelId,
      routeLabel: execution.routeDecision.label,
      upstreamApi: execution.primaryApi,
      escalated: execution.escalated,
      confidenceScore: execution.verifier?.score,
      lowConfidence: execution.lowConfidence,
      safetyGateTriggered: execution.routeDecision.safetyGateTriggered
    });
    if (normalized.stream) return execution.finalResult;
    return finalizeExecutionBody(normalized, execution.finalResult, metadata);
  }

  async function executeResponsesRequest(req, res) {
    const normalized = normalizeResponsesRequest(req.body || {});
    const execution = await executeNormalizedRequest(req, normalized);
    const metadata = buildAstrolabeMetadata(
      execution.routeDecision,
      execution.classification,
      execution.modifiers,
      buildCandidatesForRoute(execution.routeDecision, extractConversationFeatures(normalized.messages, normalized.body), execution.modifiers, inferRouteHints(normalized)),
      {
        initialModelId: execution.initialModelId,
        finalModelId: execution.finalModelId,
        upstreamApi: execution.primaryApi,
        providerPolicy: execution.providerPolicy,
        retryPath: execution.retryPath,
        reasoningContinuity: execution.reasoningContinuity,
        cost: execution.cost
      },
      execution.verifier,
      execution.toolPolicy
    );
    setRoutingHeaders(res, {
      categoryId: execution.routeDecision.categoryId,
      actionClass: execution.routeDecision.actionClass,
      complexity: execution.classification.complexity,
      adjustedComplexity: execution.routeDecision.adjustedComplexity,
      lane: execution.routeDecision.lane,
      initialModelId: execution.initialModelId,
      finalModelId: execution.finalModelId,
      routeLabel: execution.routeDecision.label,
      upstreamApi: execution.primaryApi,
      escalated: execution.escalated,
      confidenceScore: execution.verifier?.score,
      lowConfidence: execution.lowConfidence,
      safetyGateTriggered: execution.routeDecision.safetyGateTriggered
    });
    if (normalized.stream) return execution.finalResult;
    return finalizeExecutionBody(normalized, execution.primaryApi === "responses" ? execution.finalResult : execution.finalResult, metadata);
  }

  function serializeModelList(view = "virtual") {
    if (view === "raw") {
      const data = rawModelsList().map((model) => ({
        id: model.id,
        object: "model",
        key: model.key,
        aliases: model.aliases,
        name: model.short,
        tier: model.tier,
        active_default: Boolean(model.activeDefault),
        raw_only: Boolean(model.rawOnly),
        preview: Boolean(model.preview),
        availability_status: model.preview ? "preview_experimental" : model.rawOnly ? "raw_available" : "active_default",
        pricing: {
          input_per_1m: model.inputCost,
          output_per_1m: model.outputCost
        },
        context_window: model.contextWindow,
        modalities: model.modalities,
        tool_ready: model.toolReady,
        long_context: model.longContext,
        lane_tags: model.laneTags,
        role_tags: model.roleTags,
        supported_parameters: model.supportedParameters
      }));
      return {
        object: "list",
        buckets: {
          active_defaults: data.filter((model) => model.active_default).map((model) => model.id),
          raw_available: data.filter((model) => model.raw_only).map((model) => model.id),
          preview_experimental: data.filter((model) => model.preview).map((model) => model.id)
        },
        data
      };
    }
    return {
      object: "list",
      data: virtualModelsList().map((model) => ({
        id: model.id,
        object: "model",
        type: "virtual",
        lane: model.lane,
        name: model.name,
        description: model.description,
        candidates: LANE_MANIFEST[model.lane]?.defaultCandidates?.map((key) => modelIdForKey(key)) || []
      }))
    };
  }

  function serializeLaneList() {
    return {
      object: "list",
      data: Object.entries(LANE_MANIFEST).map(([lane, configEntry]) => ({
        id: configEntry.id,
        lane,
        description: configEntry.description,
        preview_allowed: ["research", "vision"].includes(lane),
        default_candidates: (configEntry.defaultCandidates || []).map((key) => ({
          key,
          id: modelIdForKey(key),
          name: modelShortForKey(key),
          preview: Boolean(modelEntryForKey(key)?.preview)
        })),
        fallback_candidates: (configEntry.fallbackCandidates || []).map((key) => ({
          key,
          id: modelIdForKey(key),
          name: modelShortForKey(key),
          preview: Boolean(modelEntryForKey(key)?.preview)
        })),
        trigger_rules: [
          lane === "auto" ? "default non-trivial OpenClaw work" : null,
          lane === "cheap" ? "simple low-risk chat, retrieval, or drafting" : null,
          lane === "coding" ? "code edit, repo work, or exec loop" : null,
          lane === "research" ? "comparative, citation-heavy, or source-heavy synthesis" : null,
          lane === "vision" ? "real multimodal inputs such as screenshots or files" : null,
          lane === "strict-json" ? "explicit structured output, tool arguments, or schema repair" : null,
          lane === "safe" ? "high-stakes or approval-required turns" : null
        ].filter(Boolean)
      }))
    };
  }

  function resolveRouteDecision(categoryId, complexity, options = {}) {
    const classification = {
      categoryId: normalizeCategoryId(categoryId) || "communication",
      complexity: normalizeComplexity(complexity) || "standard",
      modifiers: Array.isArray(options.modifiers) ? options.modifiers : []
    };
    const hints = {
      requested: options.requested || { type: "virtual", lane: "auto", requestedModel: "astrolabe/auto" },
      toolProfile: options.toolProfile || "default",
      untrustedContent: Boolean(options.untrustedContent),
      approvalRequired: Boolean(options.approvalRequired),
      trustBoundary: options.trustBoundary || "default",
      costMode: options.costMode || "default",
      latencyMode: options.latencyMode || "default"
    };
    const features = {
      hasMultimodal: Boolean(options.hasMultimodal),
      hasToolsDeclared: Boolean(options.hasToolsDeclared),
      toolMessages: Number(options.toolMessages || 0),
      approxTokens: Number(options.approxTokens || 0),
      requestText: String(options.requestText || "")
    };
    const safetyGate = options.safetyGate || { triggered: false, matchedSignals: [], actionLike: false };
    const actionClass =
      options.actionClass ||
      inferActionClass(
        {
          api: "chat",
          inputText: features.requestText || "",
          responseFormat: options.responseFormat || null,
          body: {}
        },
        hints,
        { ...features, messageCount: Number(options.messageCount || 0) },
        classification,
        safetyGate
      );
    const modifiers = collectRouteModifiers(
      { responseFormat: options.responseFormat || null },
      hints,
      { ...features, messageCount: Number(options.messageCount || 0) },
      classification,
      safetyGate,
      actionClass
    );
    return resolveCategoryRoute(
      classification,
      hints,
      { ...features, messageCount: Number(options.messageCount || 0) },
      modifiers,
      safetyGate,
      actionClass
    );
  }

  const exposedModels = {
    ...RAW_MODEL_MANIFEST,
    nano: RAW_MODEL_MANIFEST.gpt5Nano,
    mini: RAW_MODEL_MANIFEST.gpt54Mini,
    gemFlash: RAW_MODEL_MANIFEST.gem25FlashLite
  };

  return {
    buildErrorBody,
    executeChatRequest,
    executeResponsesRequest,
    serializeLaneList,
    serializeModelList,
    setRoutingHeaders,
    internals: {
      MODELS: exposedModels,
      VIRTUAL_MODEL_MANIFEST,
      CATEGORY_POLICIES,
      LANE_MANIFEST,
      CLASSIFIER_PROMPT,
      HIGH_STAKES_CONFIRM_TOKEN: config.HIGH_STAKES_CONFIRM_TOKEN,
      applyCostGuardrails,
      applyRoutingProfile,
      buildCandidatesForRoute,
      buildEscalationTarget,
      buildProviderOverrides,
      classifyRequestedModel,
      collectRouteModifiers,
      detectSafetyGate,
      determineVerificationPolicy,
      estimateCost,
      heuristicClassification,
      inferActionClass,
      isHighStakesConfirmed,
      isOnboardingLikeRequest,
      modelIdForKey,
      normalizeCategoryId,
      normalizeComplexity,
      parseClassifierOutput,
      parseSelfCheckOutput: parseVerifierOutput,
      rawModelsList,
      resolveCategoryRoute: resolveRouteDecision,
      resolveModelAlias,
      resolveModelKeyFromId,
      serializeLaneList,
      serializeModelList,
      shouldEscalateFromSelfCheck
    }
  };
}

module.exports = {
  createRuntime,
  normalizeWhitespace,
  safeText
};

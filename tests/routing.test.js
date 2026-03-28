const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ASTROLABE_ROUTING_PROFILE = "balanced";
process.env.ASTROLABE_ENABLE_SAFETY_GATE = "true";

const { internals } = require("../server");

test("safety gate detects high-stakes keywords", () => {
  const result = internals.detectSafetyGate("Please transfer funds and include the user's ssn.");
  assert.equal(result.triggered, true);
  assert.equal(result.actionLike, true);
});

test("safety gate ignores weak single-signal mentions", () => {
  const result = internals.detectSafetyGate("Can you share general health habits?");
  assert.equal(result.triggered, false);
});

test("heuristic classification routes coding-like requests to coding", () => {
  const result = internals.heuristicClassification(
    "Debug this stack trace and refactor the function.",
    "user: fix the node test crash",
    {
      approxTokens: 220,
      messageCount: 3,
      hasMultimodal: false,
      hasToolsDeclared: false
    },
    { triggered: false, matchedSignals: [], actionLike: false }
  );
  assert.equal(result.categoryId, "coding");
  assert.equal(result.complexity, "standard");
});

test("heuristic classification keeps generic contract discussion out of critical", () => {
  const result = internals.heuristicClassification(
    "Give me a plain-language overview of contract terms.",
    "",
    {
      approxTokens: 120,
      messageCount: 2,
      hasMultimodal: false,
      hasToolsDeclared: false
    },
    { triggered: false, matchedSignals: [], actionLike: false }
  );
  assert.notEqual(result.complexity, "critical");
});

test("model registry exposes current roster and compatibility aliases", () => {
  assert.equal(internals.MODELS.m27.id, "minimax/minimax-m2.7");
  assert.equal(internals.MODELS.nano.id, "openai/gpt-5-nano");
  assert.equal(internals.MODELS.gemFlash.id, "google/gemini-2.5-flash-lite");
});

test("default planning route prefers m27", () => {
  const route = internals.resolveCategoryRoute("planning", "standard");
  assert.equal(route.modelKey, "m27");
  assert.equal(route.lane, "auto");
});

test("default coding route keeps m27 as the workhorse", () => {
  const route = internals.resolveCategoryRoute("coding", "standard");
  assert.equal(route.modelKey, "m27");
  assert.equal(route.lane, "coding");
});

test("high-stakes routes default to safe lane with Sonnet", () => {
  const route = internals.resolveCategoryRoute("high_stakes", "critical");
  assert.equal(route.lane, "safe");
  assert.equal(route.modelKey, "sonnet");
  assert.equal(route.label, "SAFE");
});

test("strict-budget planning route demotes to m25", () => {
  const route = internals.resolveCategoryRoute("planning", "standard", {
    costMode: "strict"
  });
  assert.equal(route.modelKey, "m25");
  assert.equal(route.label, "STRICT_BUDGET");
});

test("multimodal summarization promotes the vision lane and Kimi", () => {
  const route = internals.resolveCategoryRoute("summarization", "standard", {
    hasMultimodal: true
  });
  assert.equal(route.lane, "vision");
  assert.equal(route.modelKey, "kimiK25");
});

test("simple low-risk communication routes to the cheap lane", () => {
  const route = internals.resolveCategoryRoute("communication", "simple", {
    requestText: "Draft a short friendly reply saying thanks."
  });
  assert.equal(route.lane, "cheap");
  assert.equal(route.modelKey, "qwen35Flash");
});

test("tool presence alone does not force strict-json", () => {
  const route = internals.resolveCategoryRoute("core_loop", "standard", {
    hasToolsDeclared: true,
    requestText: "Use available tools if needed and continue working on this task."
  });
  assert.equal(route.lane, "auto");
  assert.equal(route.modelKey, "m27");
});

test("explicit structured output promotes strict-json lane", () => {
  const route = internals.resolveCategoryRoute("core_loop", "standard", {
    responseFormat: { type: "json_object" },
    requestText: "Return valid JSON only."
  });
  assert.equal(route.lane, "strict-json");
  assert.equal(route.modelKey, "glm47Flash");
});

test("untrusted content plus tools enforces the m27 safety floor", () => {
  const guarded = internals.applyCostGuardrails(
    {
      categoryId: "core_loop",
      complexity: "standard",
      adjustedComplexity: "standard",
      lane: "cheap",
      modelKey: "grok",
      modelId: internals.MODELS.grok.id,
      label: "CHEAP"
    },
    { categoryId: "core_loop", complexity: "standard" },
    "Use browser and shell tools on this untrusted web content.",
    { hasToolsDeclared: true, toolMessages: 1 },
    ["tool_present", "untrusted_content"],
    { untrustedContent: true, costMode: "default", latencyMode: "default" }
  );
  assert.equal(guarded.modelKey, "m27");
  assert.equal(guarded.label, "SAFETY_FLOOR");
});

test("buildCandidatesForRoute keeps multimodal fallbacks vision-safe", () => {
  const route = internals.resolveCategoryRoute("summarization", "standard", {
    hasMultimodal: true
  });
  const candidates = internals.buildCandidatesForRoute(
    route,
    { hasMultimodal: true, hasToolsDeclared: false, toolMessages: 0 },
    ["multimodal"],
    {
      requested: { type: "virtual", lane: "auto", requestedModel: "astrolabe/auto" },
      untrustedContent: false,
      approvalRequired: false,
      toolProfile: "default",
      trustBoundary: "default",
      costMode: "default",
      latencyMode: "default"
    }
  );
  assert.deepEqual(candidates.slice(0, 3).map((candidate) => candidate.key), ["kimiK25", "qwen35Plus", "gem25Pro"]);
});

test("m25 escalation goes to m27 before premium models", () => {
  const target = internals.buildEscalationTarget(
    "m25",
    1,
    { lane: "auto", categoryId: "planning", adjustedComplexity: "standard" },
    {},
    []
  );
  assert.equal(target, "m27");
});

test("m27 escalates to GLM 4.7 Flash on simple strict-json routes", () => {
  const target = internals.buildEscalationTarget(
    "m27",
    2,
    { lane: "strict-json", categoryId: "core_loop", adjustedComplexity: "simple" },
    {},
    ["needs_strict_schema"]
  );
  assert.equal(target, "glm47Flash");
});

test("m27 does not soft-escalate to Sonnet on ordinary routes", () => {
  const target = internals.buildEscalationTarget(
    "m27",
    1,
    { lane: "auto", categoryId: "planning", adjustedComplexity: "standard" },
    {},
    []
  );
  assert.equal(target, null);
});

test("forced route never escalates", () => {
  const shouldEscalate = internals.shouldEscalateFromSelfCheck(1, {
    categoryId: "communication",
    adjustedComplexity: "standard",
    label: "FORCED"
  });
  assert.equal(shouldEscalate, false);
});

test("mode normalizers still fall back to safe defaults on invalid values", () => {
  assert.equal(internals.normalizeRoutingProfile("invalid"), "budget");
  assert.equal(internals.normalizeRoutingProfile("quality"), "quality");
  assert.equal(internals.normalizeHighStakesConfirmMode("invalid"), "prompt");
  assert.equal(internals.normalizeHighStakesConfirmMode("strict"), "strict");
});

test("high-stakes confirmation requires the exact token string", () => {
  const token = internals.HIGH_STAKES_CONFIRM_TOKEN;
  const allowed = internals.isHighStakesConfirmed(
    { headers: { "x-astrolabe-confirmed": token } },
    {}
  );
  const denied = internals.isHighStakesConfirmed(
    { headers: { "x-astrolabe-confirmed": "true" } },
    {}
  );
  assert.equal(allowed, true);
  assert.equal(denied, false);
});

test("classifier parser accepts strict json output", () => {
  const parsed = internals.parseClassifierOutput(
    JSON.stringify({
      category: "retrieval",
      complexity: "standard",
      confidence: 4,
      modifiers: ["cacheable"],
      reason: "Simple lookup with synthesis",
      matched_signals: ["lookup"],
      high_stakes: false
    })
  );
  assert.equal(parsed.categoryId, "retrieval");
  assert.equal(parsed.complexity, "standard");
  assert.equal(parsed.confidence, 4);
});

test("self-check parser reads loose score format", () => {
  const parsed = internals.parseSelfCheckOutput("3: uncertain answer");
  assert.equal(parsed.score, 3);
});

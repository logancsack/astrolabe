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

test("heuristic classification routes coding-like requests to coding category", () => {
  const safetyGate = { triggered: false, matchedSignals: [], actionLike: false };
  const features = {
    approxTokens: 220,
    messageCount: 3,
    hasMultimodal: false,
    hasToolsDeclared: false
  };
  const result = internals.heuristicClassification(
    "Debug this stack trace and refactor the function.",
    "user: fix the node test crash",
    features,
    safetyGate
  );
  assert.equal(result.categoryId, "coding");
});

test("heuristic complexity keeps generic legal discussion out of critical", () => {
  const safetyGate = { triggered: false, matchedSignals: [], actionLike: false };
  const features = {
    approxTokens: 120,
    messageCount: 2,
    hasMultimodal: false,
    hasToolsDeclared: false
  };
  const result = internals.heuristicClassification(
    "Give me a plain-language overview of contract terms.",
    "",
    features,
    safetyGate
  );
  assert.notEqual(result.complexity, "critical");
});

test("coding simple route uses DeepSeek coder budget model", () => {
  const route = internals.resolveCategoryRoute("coding", "simple");
  assert.equal(route.modelKey, "dsCoder");
  assert.equal(route.label, "BUDGET");
});

test("high-stakes route defaults to opus always", () => {
  const route = internals.resolveCategoryRoute("high_stakes", "critical");
  assert.equal(route.modelKey, "opus");
  assert.equal(route.label, "ALWAYS");
});

test("escalation path follows policy", () => {
  assert.equal(internals.buildEscalationTarget("grok", 2), "sonnet");
  assert.equal(
    internals.buildEscalationTarget("grok", 1, {
      categoryId: "communication",
      adjustedComplexity: "standard"
    }),
    "sonnet"
  );
  assert.equal(
    internals.buildEscalationTarget("grok", 1, {
      categoryId: "high_stakes",
      adjustedComplexity: "critical"
    }),
    "opus"
  );
  assert.equal(internals.buildEscalationTarget("opus", 3), null);
});

test("classifier parser accepts strict json", () => {
  const parsed = internals.parseClassifierOutput(
    JSON.stringify({
      category: "retrieval",
      complexity: "standard",
      confidence: 4,
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

test("mode normalizers fall back to safe defaults on invalid values", () => {
  assert.equal(internals.normalizeRoutingProfile("invalid"), "budget");
  assert.equal(internals.normalizeRoutingProfile("quality"), "quality");
  assert.equal(internals.normalizeHighStakesConfirmMode("invalid"), "prompt");
  assert.equal(internals.normalizeHighStakesConfirmMode("strict"), "strict");
});

test("high-stakes confirmation requires exact token string", () => {
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

test("cost guardrail downgrades sonnet on short onboarding request", () => {
  const routeDecision = {
    categoryId: "core_loop",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "sonnet",
    modelId: internals.MODELS.sonnet.id,
    label: "DEFAULT",
    rule: "Standard tool call",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "core_loop", complexity: "standard" },
    "Let's set up your name and profile.",
    { hasToolsDeclared: false, toolMessages: 0 }
  );
  assert.equal(guarded.modelKey, "grok");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail keeps standard planning on budget model", () => {
  const routeDecision = {
    categoryId: "planning",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "sonnet",
    modelId: internals.MODELS.sonnet.id,
    label: "STANDARD",
    rule: "Multi-constraint planning",
    injectionRisk: "MEDIUM-HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "planning", complexity: "standard" },
    "Create a schedule for my week.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 120 }
  );
  assert.equal(guarded.modelKey, "grok");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail caps critical non-high-stakes routes at sonnet", () => {
  const routeDecision = {
    categoryId: "orchestration",
    complexity: "critical",
    adjustedComplexity: "critical",
    modelKey: "opus",
    modelId: internals.MODELS.opus.id,
    label: "ESCALATE",
    rule: "High-stakes recovery orchestration",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "orchestration", complexity: "critical" },
    "Recover the failed deployment pipeline with rollback steps.",
    { hasToolsDeclared: true, toolMessages: 1, approxTokens: 2200 }
  );
  assert.equal(guarded.modelKey, "sonnet");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail keeps routine coding on deepseek coder", () => {
  const routeDecision = {
    categoryId: "coding",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "sonnet",
    modelId: internals.MODELS.sonnet.id,
    label: "DEFAULT",
    rule: "Standard feature implementation / debugging",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "coding", complexity: "standard" },
    "Write a helper function to parse CSV rows.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 200 }
  );
  assert.equal(guarded.modelKey, "dsCoder");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail preserves mid-tier for long-context multimodal summarization", () => {
  const routeDecision = {
    categoryId: "summarization",
    complexity: "complex",
    adjustedComplexity: "complex",
    modelKey: "sonnet",
    modelId: internals.MODELS.sonnet.id,
    label: "STANDARD",
    rule: "Long input / high precision",
    injectionRisk: "MEDIUM",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "summarization", complexity: "complex" },
    "Summarize this PDF.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 6200, hasMultimodal: true }
  );
  assert.equal(guarded.modelKey, "gem31Pro");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail keeps critical non-high-stakes at sonnet even when prompt is short", () => {
  const routeDecision = {
    categoryId: "communication",
    complexity: "critical",
    adjustedComplexity: "critical",
    modelKey: "opus",
    modelId: internals.MODELS.opus.id,
    label: "ESCALATE",
    rule: "Sensitive negotiation / legal / crisis messaging",
    injectionRisk: "MEDIUM",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "communication", complexity: "critical" },
    "Handle this carefully.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 160 }
  );
  assert.equal(guarded.modelKey, "sonnet");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost mode suppresses moderate-score escalation for non-critical requests", () => {
  const shouldEscalate = internals.shouldEscalateFromSelfCheck(2, {
    categoryId: "communication",
    adjustedComplexity: "standard"
  });
  assert.equal(shouldEscalate, false);
});

test("strict cost mode still allows moderate-score escalation for complex requests", () => {
  const shouldEscalate = internals.shouldEscalateFromSelfCheck(2, {
    categoryId: "coding",
    adjustedComplexity: "complex"
  });
  assert.equal(shouldEscalate, true);
});

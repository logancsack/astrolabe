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

test("model registry uses current OpenRouter IDs and updated pricing tiers", () => {
  assert.equal(internals.MODELS.dsCoder.id, "deepseek/deepseek-v3.2");
  assert.equal(internals.MODELS.gemFlash.id, "google/gemini-3-flash-preview");
  assert.equal(internals.MODELS.opus.inputCost, 5);
  assert.equal(internals.MODELS.opus.outputCost, 25);
  assert.equal(internals.MODELS.gemFlash.tier, "MID-TIER");
});

test("core loop standard route prefers M2.5", () => {
  const route = internals.resolveCategoryRoute("core_loop", "standard");
  assert.equal(route.modelKey, "m25");
  assert.equal(route.label, "DEFAULT");
});

test("planning standard route prefers M2.5", () => {
  const route = internals.resolveCategoryRoute("planning", "standard");
  assert.equal(route.modelKey, "m25");
  assert.equal(route.label, "VALUE");
});

test("coding standard route prefers M2.5", () => {
  const route = internals.resolveCategoryRoute("coding", "standard");
  assert.equal(route.modelKey, "m25");
  assert.equal(route.label, "DEFAULT");
});

test("high-stakes route defaults to opus always", () => {
  const route = internals.resolveCategoryRoute("high_stakes", "critical");
  assert.equal(route.modelKey, "opus");
  assert.equal(route.label, "ALWAYS");
});

test("escalation path follows policy", () => {
  assert.equal(internals.buildEscalationTarget("grok", 2), "m25");
  assert.equal(
    internals.buildEscalationTarget("m25", 1, {
      categoryId: "communication",
      adjustedComplexity: "standard"
    }),
    "sonnet"
  );
  assert.equal(
    internals.buildEscalationTarget("m25", 1, {
      categoryId: "high_stakes",
      adjustedComplexity: "critical"
    }),
    "opus"
  );
  assert.equal(internals.buildEscalationTarget("opus", 3), null);
});

test("m25 escalation is category-aware for multimodal and specialist contexts", () => {
  assert.equal(
    internals.buildEscalationTarget(
      "m25",
      2,
      { categoryId: "research", adjustedComplexity: "complex" },
      { hasMultimodal: true, approxTokens: 18000 }
    ),
    "kimiK25"
  );
  assert.equal(
    internals.buildEscalationTarget(
      "m25",
      2,
      { categoryId: "research", adjustedComplexity: "complex" },
      { hasMultimodal: true, approxTokens: 32000 }
    ),
    "gem31Pro"
  );
  assert.equal(
    internals.buildEscalationTarget(
      "m25",
      2,
      { categoryId: "coding", adjustedComplexity: "complex" },
      { approxTokens: 9100, requestText: "Create an architecture migration plan for this distributed service." }
    ),
    "glm5"
  );
  assert.equal(
    internals.buildEscalationTarget("m25", 2, {
      categoryId: "communication",
      adjustedComplexity: "standard"
    }),
    "sonnet"
  );
});

test("forced route never escalates on self-check", () => {
  const shouldEscalate = internals.shouldEscalateFromSelfCheck(1, {
    categoryId: "communication",
    adjustedComplexity: "standard",
    label: "FORCED"
  });
  assert.equal(shouldEscalate, false);
  assert.equal(
    internals.buildEscalationTarget("nano", 1, {
      categoryId: "communication",
      adjustedComplexity: "standard",
      label: "FORCED"
    }),
    null
  );
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

test("cost guardrail keeps simple onboarding on Grok", () => {
  const routeDecision = {
    categoryId: "core_loop",
    complexity: "simple",
    adjustedComplexity: "simple",
    modelKey: "sonnet",
    modelId: internals.MODELS.sonnet.id,
    label: "STANDARD",
    rule: "Simple tool call",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "core_loop", complexity: "simple" },
    "Let's set up your name and profile.",
    { hasToolsDeclared: false, toolMessages: 0 }
  );
  assert.equal(guarded.modelKey, "grok");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail keeps simple retrieval on Nano", () => {
  const routeDecision = {
    categoryId: "retrieval",
    complexity: "simple",
    adjustedComplexity: "simple",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "VALUE",
    rule: "Simple lookup",
    injectionRisk: "MEDIUM-HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "retrieval", complexity: "simple" },
    "Find my next calendar event.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 140 }
  );
  assert.equal(guarded.modelKey, "nano");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes standard planning to M2.5", () => {
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
  assert.equal(guarded.modelKey, "m25");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes standard coding to M2.5", () => {
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
  assert.equal(guarded.modelKey, "m25");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes standard research to M2.5", () => {
  const routeDecision = {
    categoryId: "research",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "sonnet",
    modelId: internals.MODELS.sonnet.id,
    label: "DEFAULT",
    rule: "Deep text-heavy synthesis and comparative analysis",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "research", complexity: "standard" },
    "Compare these three market reports and summarize the trade-offs.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 420 }
  );
  assert.equal(guarded.modelKey, "m25");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail keeps light tool-use core loop on Grok", () => {
  const routeDecision = {
    categoryId: "core_loop",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "DEFAULT",
    rule: "Standard and complex tool chains",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "core_loop", complexity: "standard" },
    "Call the calendar tool and fetch tomorrow's events.",
    { hasToolsDeclared: true, toolMessages: 1, approxTokens: 900 }
  );
  assert.equal(guarded.modelKey, "grok");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail does not keep heavy tool churn on Grok", () => {
  const routeDecision = {
    categoryId: "core_loop",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "DEFAULT",
    rule: "Standard and complex tool chains",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "core_loop", complexity: "standard" },
    "Run the full chain and keep retrying tools until completion.",
    { hasToolsDeclared: true, toolMessages: 3, approxTokens: 1600 }
  );
  assert.equal(guarded.modelKey, "m25");
});

test("strict cost guardrail caps critical non-high-stakes routes at M2.5", () => {
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
  assert.equal(guarded.modelKey, "m25");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes standard multimodal requests to Kimi K2.5", () => {
  const routeDecision = {
    categoryId: "summarization",
    complexity: "standard",
    adjustedComplexity: "standard",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "VALUE",
    rule: "Medium text summarization and extraction",
    injectionRisk: "MEDIUM",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "summarization", complexity: "standard" },
    "Summarize this image and attached notes.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 1200, hasMultimodal: true }
  );
  assert.equal(guarded.modelKey, "kimiK25");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes long-context multimodal summarization to Gemini 3.1 Pro", () => {
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
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 32000, hasMultimodal: true }
  );
  assert.equal(guarded.modelKey, "gem31Pro");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes large-context complex coding to GLM-5", () => {
  const routeDecision = {
    categoryId: "coding",
    complexity: "complex",
    adjustedComplexity: "complex",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "DEFAULT",
    rule: "Standard and complex feature implementation / debugging",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "coding", complexity: "complex" },
    "Refactor this service and provide architecture-level migration notes.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 9200 }
  );
  assert.equal(guarded.modelKey, "glm5");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes large-context complex research to GLM-5", () => {
  const routeDecision = {
    categoryId: "research",
    complexity: "complex",
    adjustedComplexity: "complex",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "DEFAULT",
    rule: "Deep text-heavy synthesis and comparative analysis",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "research", complexity: "complex" },
    "Deep comparative analysis with citations across these long reports.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 13000 }
  );
  assert.equal(guarded.modelKey, "glm5");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail routes very-long multimodal complex research to Gemini 3.1 Pro", () => {
  const routeDecision = {
    categoryId: "research",
    complexity: "complex",
    adjustedComplexity: "complex",
    modelKey: "m25",
    modelId: internals.MODELS.m25.id,
    label: "DEFAULT",
    rule: "Deep text-heavy synthesis and comparative analysis",
    injectionRisk: "HIGH",
    safetyGateTriggered: false
  };
  const guarded = internals.applyCostGuardrails(
    routeDecision,
    { categoryId: "research", complexity: "complex" },
    "Compare these multimodal documents and synthesize findings.",
    { hasToolsDeclared: false, toolMessages: 0, approxTokens: 32000, hasMultimodal: true }
  );
  assert.equal(guarded.modelKey, "gem31Pro");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("strict cost guardrail keeps critical non-high-stakes at M2.5 even when prompt is short", () => {
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
  assert.equal(guarded.modelKey, "m25");
  assert.equal(guarded.label, "BUDGET_GUARDRAIL");
});

test("non-high-stakes direct route never selects Sonnet for simple/standard/complex", () => {
  const nonHighStakesCategories = internals.CATEGORY_POLICIES.map((policy) => policy.id).filter(
    (categoryId) => categoryId !== "high_stakes"
  );
  for (const categoryId of nonHighStakesCategories) {
    for (const complexity of ["simple", "standard", "complex"]) {
      const route = internals.resolveCategoryRoute(categoryId, complexity);
      assert.notEqual(route.modelKey, "sonnet", `${categoryId}/${complexity} should not route to Sonnet`);
    }
  }
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

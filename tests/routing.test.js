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
  assert.equal(internals.buildEscalationTarget("grok", 1), "opus");
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

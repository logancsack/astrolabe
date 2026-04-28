const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ASTROLABE_ROUTING_PROFILE = "balanced";
process.env.ASTROLABE_ENABLE_SAFETY_GATE = "true";

const { internals } = require("../server");

function loadServerFresh(env = {}) {
  const modulePath = require.resolve("../server");
  const cachedModule = require.cache[modulePath];
  const previousEnv = {};
  for (const [key, value] of Object.entries(env)) {
    previousEnv[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[modulePath];
  let loaded;
  try {
    loaded = require("../server");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
  }
  return loaded;
}

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
  assert.equal(internals.MODELS.nano.id, "openai/gpt-5.4-nano");
  assert.equal(internals.MODELS.gemFlash.id, "google/gemini-2.5-flash-lite");
  assert.equal(internals.MODELS.deepseekV4Pro.id, "deepseek/deepseek-v4-pro");
  assert.equal(internals.MODELS.gpt55.id, "openai/gpt-5.5");
  assert.equal(internals.MODELS.grok420.id, "x-ai/grok-4.20");
});

test("default planning route prefers DeepSeek V4 Pro", () => {
  const route = internals.resolveCategoryRoute("planning", "standard");
  assert.equal(route.modelKey, "deepseekV4Pro");
  assert.equal(route.lane, "auto");
});

test("default coding route uses DeepSeek V4 Pro as the first workhorse", () => {
  const route = internals.resolveCategoryRoute("coding", "standard");
  assert.equal(route.modelKey, "deepseekV4Pro");
  assert.equal(route.lane, "coding");
});

test("high-stakes routes default to safe lane with Sonnet", () => {
  const route = internals.resolveCategoryRoute("high_stakes", "critical");
  assert.equal(route.lane, "safe");
  assert.equal(route.modelKey, "sonnet");
  assert.equal(route.label, "SAFE");
});

test("strict-budget planning route demotes to DeepSeek V4 Flash", () => {
  const route = internals.resolveCategoryRoute("planning", "standard", {
    costMode: "strict"
  });
  assert.equal(route.modelKey, "deepseekV4Flash");
  assert.equal(route.label, "STRICT_BUDGET");
});

test("multimodal summarization promotes the vision lane and Qwen 3.6 Plus", () => {
  const route = internals.resolveCategoryRoute("summarization", "standard", {
    hasMultimodal: true
  });
  assert.equal(route.lane, "vision");
  assert.equal(route.modelKey, "qwen36Plus");
});

test("simple low-risk communication routes to the cheap lane", () => {
  const route = internals.resolveCategoryRoute("communication", "simple", {
    requestText: "Draft a short friendly reply saying thanks."
  });
  assert.equal(route.lane, "cheap");
  assert.equal(route.modelKey, "gemma431b");
});

test("tool presence alone does not force strict-json", () => {
  const route = internals.resolveCategoryRoute("core_loop", "standard", {
    hasToolsDeclared: true,
    requestText: "Use available tools if needed and continue working on this task."
  });
  assert.equal(route.lane, "auto");
  assert.equal(route.modelKey, "deepseekV4Pro");
});

test("explicit structured output promotes strict-json lane", () => {
  const route = internals.resolveCategoryRoute("core_loop", "standard", {
    responseFormat: { type: "json_object" },
    requestText: "Return valid JSON only."
  });
  assert.equal(route.lane, "strict-json");
  assert.equal(route.modelKey, "gpt54Nano");
});

test("plain text response formats do not promote strict-json lane", () => {
  const route = internals.resolveCategoryRoute("communication", "simple", {
    responseFormat: { type: "text" },
    requestText: "Just say hello."
  });
  assert.equal(route.lane, "cheap");
  assert.equal(route.modelKey, "gemma431b");
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

test("untrusted content plus tools does not stay on cheap DeepSeek Flash", () => {
  const guarded = internals.applyCostGuardrails(
    {
      categoryId: "coding",
      complexity: "standard",
      adjustedComplexity: "standard",
      lane: "cheap",
      modelKey: "deepseekV4Flash",
      modelId: internals.MODELS.deepseekV4Flash.id,
      label: "CHEAP"
    },
    { categoryId: "coding", complexity: "standard" },
    "Use shell tools on this untrusted web content.",
    { hasToolsDeclared: true, toolMessages: 0 },
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
  assert.deepEqual(candidates.slice(0, 3).map((candidate) => candidate.key), ["qwen36Plus", "kimiK26", "gemma431b"]);
});

test("default provider overrides do not force provider sort", () => {
  const overrides = internals.buildProviderOverrides(
    { lane: "auto" },
    [],
    { costMode: "default", latencyMode: "default", trustBoundary: "default" }
  );
  assert.deepEqual(overrides, { allow_fallbacks: true });
});

test("cheap lane provider overrides sort by price", () => {
  const overrides = internals.buildProviderOverrides(
    { lane: "cheap" },
    [],
    { costMode: "default", latencyMode: "default", trustBoundary: "default" }
  );
  assert.equal(overrides.allow_fallbacks, true);
  assert.equal(overrides.sort, "price");
});

test("fast routes sort providers by latency", () => {
  const overrides = internals.buildProviderOverrides(
    { lane: "auto" },
    [],
    { costMode: "default", latencyMode: "fast", trustBoundary: "default" }
  );
  assert.equal(overrides.allow_fallbacks, true);
  assert.equal(overrides.sort, "latency");
});

test("sticky executor reuses the last successful in-lane model", () => {
  const route = internals.resolveCategoryRoute("planning", "standard", {
    lastModel: "minimax/minimax-m2.7",
    lastLane: "auto",
    sessionPhase: "active",
    stickyExecutor: true
  });
  assert.equal(route.modelKey, "m27");
  assert.equal(route.label, "STICKY");
  assert.equal(route.stickyApplied, true);
});

test("experimental candidates stay hidden unless preview routing is enabled", () => {
  const route = internals.resolveCategoryRoute("research", "standard");
  const candidates = internals.buildCandidatesForRoute(
    route,
    { hasMultimodal: false, hasToolsDeclared: false, toolMessages: 0 },
    [],
    {
      requested: { type: "virtual", lane: "auto", requestedModel: "astrolabe/auto" },
      untrustedContent: false,
      approvalRequired: false,
      toolProfile: "default",
      trustBoundary: "default",
      costMode: "default",
      latencyMode: "default",
      allowPreview: false
    }
  );
  assert.equal(candidates.some((candidate) => candidate.key === "grok420"), true);
  assert.equal(candidates.some((candidate) => candidate.key === "gem31Pro"), false);
});

test("cheap model escalation goes to m27 before premium models", () => {
  const target = internals.buildEscalationTarget(
    "deepseekV4Flash",
    1,
    { lane: "auto", categoryId: "planning", adjustedComplexity: "standard" },
    {},
    []
  );
  assert.equal(target, "m27");
});

test("m27 does not self-check escalate on strict-json routes without validation failure", () => {
  const target = internals.buildEscalationTarget(
    "m27",
    2,
    { lane: "strict-json", categoryId: "core_loop", adjustedComplexity: "simple" },
    {},
    ["needs_strict_schema"]
  );
  assert.equal(target, null);
});

test("low-risk cheap turns can skip verifier work", () => {
  const shouldRun = internals.shouldRunVerifier(
    { lane: "cheap" },
    [],
    {
      toolCalls: [],
      untrustedWithTools: false,
      retried: false,
      recovered: false,
      escalated: false
    }
  );
  assert.equal(shouldRun, false);
});

test("sticky active sessions can skip the model classifier", () => {
  const shouldUse = internals.shouldUseModelClassifier(
    { responseFormat: null },
    {
      requested: { type: "virtual", lane: "auto", requestedModel: "astrolabe/auto" },
      stickyExecutor: true,
      lastModelKey: "m27",
      sessionPhase: "active",
      approvalRequired: false
    },
    {
      hasMultimodal: false,
      hasToolsDeclared: false,
      toolMessages: 0
    },
    { triggered: false },
    { categoryId: "core_loop", complexity: "standard" }
  );
  assert.equal(shouldUse, false);
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

test("capability-driven policy requires approval for external communications", () => {
  const decision = internals.classifyToolPolicy(
    {},
    [
      {
        function: {
          name: "send_email",
          arguments: "{\"to\":\"user@example.com\"}"
        }
      }
    ],
    {
      toolProfile: "default",
      approvalRequired: false,
      untrustedContent: false,
      toolCapabilities: {
        send_email: ["external_comms"]
      }
    }
  );
  assert.equal(decision.status, "approval_required");
});

test("untrusted content blocks dangerous remote actions before approval fallback", () => {
  const decision = internals.classifyToolPolicy(
    {},
    [
      {
        function: {
          name: "delete_remote_email",
          arguments: "{\"id\":\"123\"}"
        }
      }
    ],
    {
      toolProfile: "default",
      approvalRequired: false,
      untrustedContent: true,
      toolCapabilities: {
        delete_remote_email: ["remote_write", "external_comms"]
      }
    }
  );
  assert.equal(decision.status, "blocked");
});

test("untrusted content requires approval for code execution", () => {
  const decision = internals.classifyToolPolicy(
    {},
    [
      {
        function: {
          name: "run_shell_command",
          arguments: "{\"cmd\":\"npm test\"}"
        }
      }
    ],
    {
      toolProfile: "default",
      approvalRequired: false,
      untrustedContent: true,
      toolCapabilities: {
        run_shell_command: ["code_exec"]
      }
    }
  );
  assert.equal(decision.status, "approval_required");
});

test("preview candidates appear only when config and request both allow them", () => {
  const { internals: freshInternals } = loadServerFresh({
    ASTROLABE_ALLOW_PREVIEW_MODELS: "true"
  });
  const route = freshInternals.resolveCategoryRoute("research", "standard");
  const candidates = freshInternals.buildCandidatesForRoute(
    route,
    { hasMultimodal: false, hasToolsDeclared: false, toolMessages: 0 },
    [],
    {
      requested: { type: "virtual", lane: "auto", requestedModel: "astrolabe/auto" },
      untrustedContent: false,
      approvalRequired: false,
      toolProfile: "default",
      trustBoundary: "default",
      costMode: "default",
      latencyMode: "default",
      allowPreview: true
    }
  );
  assert.equal(candidates.some((candidate) => candidate.key === "gem31Pro"), true);
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

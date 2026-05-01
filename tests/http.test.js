const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { PassThrough } = require("node:stream");
const axios = require("axios");

process.env.ASTROLABE_ENABLE_SAFETY_GATE = "true";
process.env.ASTROLABE_HIGH_STAKES_CONFIRM_MODE = "strict";
process.env.ASTROLABE_HIGH_STAKES_CONFIRM_TOKEN = "ultra-confirm";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-openrouter-key";

const { app } = require("../server");

function requestJson(port, { method = "GET", path = "/", body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload)
              }
            : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestRaw(port, { method = "GET", path = "/", body, rawBody, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = rawBody != null ? String(rawBody) : body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload)
              }
            : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function isClassifierPayload(payload) {
  return payload?.messages?.[0]?.role === "system" && String(payload.messages[0]?.content || "").includes("strict routing classifier");
}

function isVerifierPayload(payload) {
  return payload?.messages?.[0]?.role === "system" && String(payload.messages[0]?.content || "").includes("keys score and reason");
}

async function withAxiosStub(stub, run) {
  const original = axios.post;
  axios.post = stub;
  try {
    await run();
  } finally {
    axios.post = original;
  }
}

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

test("GET /health returns service metadata for the new runtime", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, { path: "/health" });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.service, "astrolabe");
    assert.equal(response.body.version, "0.3.0-beta.0");
    assert.equal(response.body.default_profile, "default");
    assert.equal(response.body.responses_enabled, true);
    assert.equal(response.body.chat_completions_enabled, true);
  } finally {
    server.close();
  }
});

test("GET /v1/models returns virtual models by default", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, { path: "/v1/models" });
    assert.equal(response.status, 200);
    assert.equal(response.body.object, "list");
    assert.ok(response.body.data.some((model) => model.id === "astrolabe/auto"));
    assert.ok(response.body.data.some((model) => model.id === "astrolabe/strict-json"));
  } finally {
    server.close();
  }
});

test("GET /v1/models?view=raw returns the static checked-in roster", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, { path: "/v1/models?view=raw" });
    assert.equal(response.status, 200);
    assert.ok(response.body.data.some((model) => model.id === "minimax/minimax-m2.7"));
    assert.ok(response.body.data.some((model) => model.id === "deepseek/deepseek-v4-pro"));
    assert.ok(response.body.data.some((model) => model.id === "x-ai/grok-4.3"));
    assert.ok(response.body.data.some((model) => model.id === "openai/gpt-5.5"));
    assert.ok(Array.isArray(response.body.buckets.defaults));
    assert.ok(Array.isArray(response.body.buckets.raw_only));
    assert.ok(Array.isArray(response.body.buckets.experimental));
    assert.ok(response.body.buckets.defaults.includes("deepseek/deepseek-v4-pro"));
    assert.ok(response.body.buckets.defaults.includes("x-ai/grok-4.3"));
    assert.equal(response.body.buckets.defaults.includes("x-ai/grok-4.20"), false);
    assert.ok(response.body.buckets.raw_only.includes("x-ai/grok-4.20"));
    assert.ok(response.body.buckets.raw_only.includes("openai/gpt-5-nano"));
  } finally {
    server.close();
  }
});

test("GET /v1/lanes exposes lane manifests", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, { path: "/v1/lanes" });
    assert.equal(response.status, 200);
    const codingLane = response.body.data.find((lane) => lane.lane === "coding");
    const researchLane = response.body.data.find((lane) => lane.lane === "research");
    assert.ok(codingLane);
    assert.ok(researchLane);
    assert.equal(codingLane.default_candidates[0].id, "deepseek/deepseek-v4-pro");
    assert.ok(researchLane.default_candidates.some((candidate) => candidate.id === "x-ai/grok-4.3"));
    assert.equal(researchLane.default_candidates.some((candidate) => candidate.id === "x-ai/grok-4.20"), false);
  } finally {
    server.close();
  }
});

test("POST /v1/chat/completions returns 400 when messages is missing", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, {
      method: "POST",
      path: "/v1/chat/completions",
      body: {}
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.type, "invalid_request_error");
  } finally {
    server.close();
  }
});

test("POST /v1/responses returns 400 when input is missing", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, {
      method: "POST",
      path: "/v1/responses",
      body: {}
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "missing_input");
  } finally {
    server.close();
  }
});

test("POST /v1/chat/completions returns JSON error on malformed JSON body", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestRaw(port, {
      method: "POST",
      path: "/v1/chat/completions",
      rawBody: "{\"messages\":[",
      headers: { "content-type": "application/json" }
    });
    assert.equal(response.status, 400);
    const parsed = JSON.parse(response.body);
    assert.equal(parsed.error.code, "invalid_json");
  } finally {
    server.close();
  }
});

test("rate limiter blocks over-budget requests before upstream call", { concurrency: false }, async () => {
  const { app: limitedApp } = loadServerFresh({
    ASTROLABE_RATE_LIMIT_ENABLED: "true",
    ASTROLABE_RATE_LIMIT_MAX_REQUESTS: "1",
    ASTROLABE_RATE_LIMIT_WINDOW_MS: "60000",
    ASTROLABE_API_KEY: "rate-limit-test-key"
  });
  const server = limitedApp.listen(0);
  try {
    const { port } = server.address();
    let axiosCalls = 0;
    await withAxiosStub(async (url, payload) => {
      axiosCalls += 1;
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "communication", complexity: "simple", confidence: 5 }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "looks fine" }) } }]
          }
        };
      }
      return {
        status: 200,
        data: {
          id: "chatcmpl-rate-limit",
          object: "chat.completion",
          created: 1,
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 }
        }
      };
    }, async () => {
      const authHeaders = { authorization: "Bearer rate-limit-test-key" };
      const first = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        headers: authHeaders,
        body: { messages: [{ role: "user", content: "Say hello." }], stream: false }
      });
      assert.equal(first.status, 200);
      const callsAfterFirst = axiosCalls;
      const second = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        headers: authHeaders,
        body: { messages: [{ role: "user", content: "Say hello again." }], stream: false }
      });
      assert.equal(second.status, 429);
      assert.equal(second.body.error.code, "rate_limit_exceeded");
      assert.equal(axiosCalls, callsAfterFirst);
    });
  } finally {
    server.close();
  }
});

test("strict high-stakes confirmation requires exact token", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, {
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        stream: false,
        messages: [{ role: "user", content: "Please transfer $100 now." }]
      }
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "high_stakes_confirmation_required");
  } finally {
    server.close();
  }
});

test("non-stream chat responses include routing headers and astrolabe metadata", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await withAxiosStub(async (url, payload) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "retrieval",
                    complexity: "simple",
                    confidence: 5,
                    modifiers: [],
                    reason: "simple lookup"
                  })
                }
              }
            ]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      return {
        status: 200,
        data: {
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          choices: [{ message: { role: "assistant", content: "Sunny and 72F." } }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        }
      };
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          messages: [{ role: "user", content: "Find the weather in Austin." }]
        }
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers["x-astrolabe-category"], "retrieval");
      assert.equal(response.headers["x-astrolabe-action-class"], "casual_chat");
      assert.equal(response.headers["x-astrolabe-initial-model"], "google/gemma-4-31b-it");
      assert.equal(response.headers["x-astrolabe-final-model"], "google/gemma-4-31b-it");
      assert.equal(response.body.astrolabe.category, "retrieval");
      assert.equal(response.body.choices[0].message.content, "Sunny and 72F.");
    });
  } finally {
    server.close();
  }
});

test("planning requests route to DeepSeek V4 Pro by default", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await withAxiosStub(async (url, payload) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "planning", complexity: "standard", confidence: 5 }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      return {
        status: 200,
        data: {
          id: "chatcmpl-planning",
          object: "chat.completion",
          created: 1,
          choices: [{ message: { role: "assistant", content: "Plan drafted." } }],
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 }
        }
      };
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          messages: [{ role: "user", content: "Create a two-week launch plan for this feature." }]
        }
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers["x-astrolabe-category"], "planning");
      assert.equal(response.headers["x-astrolabe-initial-model"], "deepseek/deepseek-v4-pro");
      assert.equal(response.headers["x-astrolabe-final-model"], "deepseek/deepseek-v4-pro");
    });
  } finally {
    server.close();
  }
});

test("responses endpoint prefers OpenRouter responses and returns response objects", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const calledUrls = [];
    await withAxiosStub(async (url, payload) => {
      calledUrls.push(url);
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "research", complexity: "complex", confidence: 5 }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      if (url.endsWith("/responses")) {
        return {
          status: 200,
          data: {
            id: "resp_123",
            object: "response",
            created: 1,
            model: "qwen/qwen3.6-plus",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Research summary." }]
              }
            ],
            usage: { input_tokens: 18, output_tokens: 9, total_tokens: 27 }
          }
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/responses",
        body: {
          model: "astrolabe/research",
          input: "Research the trade-offs for this migration and summarize the key risks.",
          stream: false
        }
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.object, "response");
      assert.equal(response.body.metadata.astrolabe.category, "research");
      assert.ok(calledUrls.some((url) => url.endsWith("/responses")));
    });
  } finally {
    server.close();
  }
});

test("responses endpoint falls back to chat when responses upstream is retryably unavailable", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const calledUrls = [];
    await withAxiosStub(async (url, payload) => {
      calledUrls.push(url);
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "communication", complexity: "simple", confidence: 5 }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      if (url.endsWith("/responses")) {
        return {
          status: 404,
          data: {
            error: {
              code: "model_not_found",
              message: "Responses path unavailable."
            }
          }
        };
      }
      return {
        status: 200,
        data: {
          id: "chatcmpl-fallback",
          object: "chat.completion",
          created: 1,
          choices: [{ message: { role: "assistant", content: "Fallback succeeded." } }],
          usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 }
        }
      };
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/responses",
        body: {
          input: "Say hello in one line.",
          stream: false
        }
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.object, "response");
      assert.equal(response.body.output[0].content[0].text, "Fallback succeeded.");
      assert.ok(calledUrls.filter((url) => url.endsWith("/responses")).length >= 2);
      assert.ok(calledUrls.some((url) => url.endsWith("/chat/completions")));
    });
  } finally {
    server.close();
  }
});

test("multimodal requests retry multimodal-capable lane candidates first", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const attempts = [];
    await withAxiosStub(async (url, payload) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "summarization", complexity: "standard", confidence: 5, modifiers: ["multimodal"] }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      attempts.push(payload.model);
      if (payload.model === "qwen/qwen3.6-plus") {
        return {
          status: 404,
          data: {
            error: {
              code: "model_not_found",
              message: "Model unavailable."
            }
          }
        };
      }
      if (payload.model === "moonshotai/kimi-k2.6") {
        return {
          status: 200,
          data: {
            id: "chatcmpl-mm",
            object: "chat.completion",
            created: 1,
            choices: [{ message: { role: "assistant", content: "Multimodal fallback succeeded." } }],
            usage: { prompt_tokens: 14, completion_tokens: 7, total_tokens: 21 }
          }
        };
      }
      throw new Error(`Unexpected model ${payload.model}`);
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Summarize this screenshot." },
                { type: "image_url", image_url: { url: "https://example.com/image.png" } }
              ]
            }
          ]
        }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(attempts.slice(0, 3), ["qwen/qwen3.6-plus", "qwen/qwen3.6-plus", "moonshotai/kimi-k2.6"]);
      assert.equal(response.headers["x-astrolabe-final-model"], "moonshotai/kimi-k2.6");
    });
  } finally {
    server.close();
  }
});

test("forced model bypasses classifier and verifier work", { concurrency: false }, async () => {
  const { app: forcedApp } = loadServerFresh({
    ASTROLABE_FORCE_MODEL: "openai/gpt-5-nano"
  });
  const server = forcedApp.listen(0);
  try {
    const { port } = server.address();
    const upstreamModels = [];
    await withAxiosStub(async (url, payload) => {
      upstreamModels.push(payload.model);
      assert.equal(payload.model, "openai/gpt-5-nano");
      return {
        status: 200,
        data: {
          id: "chatcmpl-forced",
          object: "chat.completion",
          created: 1,
          choices: [{ message: { role: "assistant", content: "Forced model response." } }],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
        }
      };
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          messages: [{ role: "user", content: "Say hello in one line." }]
        }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(upstreamModels, ["openai/gpt-5-nano"]);
      assert.equal(response.headers["x-astrolabe-route-label"], "FORCED");
      assert.equal(response.headers["x-astrolabe-final-model"], "openai/gpt-5-nano");
    });
  } finally {
    server.close();
  }
});

test("DeepSeek V4 Pro chat payload strips unsupported parameters before upstream dispatch", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const upstreamPayloads = [];
    await withAxiosStub(async (url, payload) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "planning", complexity: "standard", confidence: 5 }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      upstreamPayloads.push(payload);
      return {
        status: 200,
        data: {
          id: "chatcmpl-sanitize",
          object: "chat.completion",
          created: 1,
          choices: [{ message: { role: "assistant", content: "Sanitized." } }],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
        }
      };
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          temperature: 0.2,
          parallel_tool_calls: true,
          verbosity: "high",
          messages: [{ role: "user", content: "Create a short implementation plan." }]
        }
      });
      assert.equal(response.status, 200);
      const deepseekPayload = upstreamPayloads.find((payload) => payload.model === "deepseek/deepseek-v4-pro");
      assert.ok(deepseekPayload);
      assert.equal("parallel_tool_calls" in deepseekPayload, false);
      assert.equal("verbosity" in deepseekPayload, false);
      assert.equal(deepseekPayload.temperature, 0.2);
    });
  } finally {
    server.close();
  }
});

test("strict-json requests try GPT-5.4 Nano first and recover through GLM 5.1", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const attemptedModels = [];
    await withAxiosStub(async (url, payload) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "core_loop", complexity: "standard", confidence: 5 }) } }]
          }
        };
      }
      if (isVerifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }
      attemptedModels.push(payload.model);
      if (payload.model === "openai/gpt-5.4-nano") {
        return {
          status: 200,
          data: {
            id: "chatcmpl-invalid-json",
            object: "chat.completion",
            created: 1,
            choices: [{ message: { role: "assistant", content: "not json" } }],
            usage: { prompt_tokens: 18, completion_tokens: 4, total_tokens: 22 }
          }
        };
      }
      if (payload.model === "z-ai/glm-5.1") {
        return {
          status: 200,
          data: {
            id: "chatcmpl-valid-json",
            object: "chat.completion",
            created: 1,
            choices: [{ message: { role: "assistant", content: "{\"ok\":true}" } }],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
          }
        };
      }
      throw new Error(`Unexpected model ${payload.model}`);
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: "Return valid JSON only." }]
        }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(attemptedModels.slice(0, 2), ["openai/gpt-5.4-nano", "z-ai/glm-5.1"]);
      assert.equal(response.headers["x-astrolabe-initial-model"], "openai/gpt-5.4-nano");
      assert.equal(response.headers["x-astrolabe-final-model"], "z-ai/glm-5.1");
    });
  } finally {
    server.close();
  }
});

test("responses URL allowlists are enforced", { concurrency: false }, async () => {
  const { app: guardedApp } = loadServerFresh({
    ASTROLABE_RESPONSES_IMAGES_URL_ALLOWLIST: "allowed.example"
  });
  const server = guardedApp.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, {
      method: "POST",
      path: "/v1/responses",
      body: {
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_image", image_url: "https://blocked.example/image.png" }]
          }
        ],
        stream: false
      }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "responses_url_not_allowed");
  } finally {
    server.close();
  }
});

test("streaming chat completions passthrough SSE payload", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await withAxiosStub(async (url, payload, options) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ category: "creative", complexity: "simple", confidence: 5 }) } }]
          }
        };
      }
      if (options?.responseType === "stream") {
        const stream = new PassThrough();
        process.nextTick(() => {
          stream.write("data: {\"id\":\"chatcmpl-stream\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n");
          stream.write("data: [DONE]\n\n");
          stream.end();
        });
        return {
          status: 200,
          data: stream,
          headers: { "content-type": "text/event-stream; charset=utf-8" }
        };
      }
      throw new Error("Unexpected non-stream upstream call.");
    }, async () => {
      const response = await requestRaw(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: true,
          messages: [{ role: "user", content: "Give me a short fun line." }]
        }
      });
      assert.equal(response.status, 200);
      assert.match(String(response.headers["content-type"] || ""), /text\/event-stream/i);
      assert.match(response.body, /chatcmpl-stream/);
      assert.match(response.body, /\[DONE\]/);
    });
  } finally {
    server.close();
  }
});

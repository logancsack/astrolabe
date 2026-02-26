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
          const parsed = raw ? JSON.parse(raw) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed
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

function isSelfCheckPayload(payload) {
  return payload?.messages?.[0]?.role === "system" && String(payload.messages[0]?.content || "").includes("strict answer quality checker");
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

test("GET /health returns service metadata", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await requestJson(port, { path: "/health" });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.service, "astrolabe");
    assert.equal(response.body.version, "0.2.0-beta.1");
    assert.equal(response.body.cost_efficiency_mode, "strict");
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
    assert.match(String(response.headers["content-type"] || ""), /application\/json/i);

    const parsed = JSON.parse(response.body);
    assert.equal(parsed.error.type, "invalid_request_error");
    assert.equal(parsed.error.code, "invalid_json");
  } finally {
    server.close();
  }
});

test("rate limiter blocks over-budget requests before upstream call", { concurrency: false }, async () => {
  const modulePath = require.resolve("../server");
  const cachedModule = require.cache[modulePath];
  const previousEnv = {
    ASTROLABE_RATE_LIMIT_ENABLED: process.env.ASTROLABE_RATE_LIMIT_ENABLED,
    ASTROLABE_RATE_LIMIT_MAX_REQUESTS: process.env.ASTROLABE_RATE_LIMIT_MAX_REQUESTS,
    ASTROLABE_RATE_LIMIT_WINDOW_MS: process.env.ASTROLABE_RATE_LIMIT_WINDOW_MS,
    ASTROLABE_API_KEY: process.env.ASTROLABE_API_KEY
  };

  let limitedApp = null;
  try {
    delete require.cache[modulePath];
    process.env.ASTROLABE_RATE_LIMIT_ENABLED = "true";
    process.env.ASTROLABE_RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.ASTROLABE_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.ASTROLABE_API_KEY = "rate-limit-test-key";
    ({ app: limitedApp } = require("../server"));
  } finally {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
  }

  const server = limitedApp.listen(0);
  try {
    const { port } = server.address();
    let axiosCalls = 0;

    await withAxiosStub(async (url, payload, options) => {
      axiosCalls += 1;

      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "communication",
                    complexity: "simple",
                    confidence: 5,
                    reason: "casual chat",
                    matched_signals: ["chat"],
                    high_stakes: false
                  })
                }
              }
            ]
          }
        };
      }

      if (isSelfCheckPayload(payload)) {
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
        body: {
          stream: false,
          messages: [{ role: "user", content: "Say hello." }]
        }
      });

      assert.equal(first.status, 200);
      assert.equal(first.headers["x-ratelimit-limit"], "1");
      assert.equal(first.headers["x-ratelimit-remaining"], "0");

      const callsAfterFirst = axiosCalls;
      const second = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        headers: authHeaders,
        body: {
          stream: false,
          messages: [{ role: "user", content: "Say hello again." }]
        }
      });

      assert.equal(second.status, 429);
      assert.equal(second.body.error.type, "rate_limit_error");
      assert.equal(second.body.error.code, "rate_limit_exceeded");
      assert.match(String(second.headers["retry-after"] || ""), /^[0-9]+$/);
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
    const payload = {
      stream: false,
      messages: [{ role: "user", content: "Please transfer $100 now." }]
    };

    const missingToken = await requestJson(port, {
      method: "POST",
      path: "/v1/chat/completions",
      body: payload
    });
    assert.equal(missingToken.status, 409);
    assert.equal(missingToken.body.error.code, "high_stakes_confirmation_required");

    const weakToken = await requestJson(port, {
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "x-astrolabe-confirmed": "true" },
      body: payload
    });
    assert.equal(weakToken.status, 409);
    assert.equal(weakToken.body.error.code, "high_stakes_confirmation_required");
  } finally {
    server.close();
  }
});

test("non-stream responses include routing metadata headers", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await withAxiosStub(async (url, payload, options) => {
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
                    reason: "simple lookup",
                    matched_signals: ["lookup"],
                    high_stakes: false
                  })
                }
              }
            ]
          }
        };
      }

      if (isSelfCheckPayload(payload)) {
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
      assert.equal(response.headers["x-astrolabe-escalated"], "false");
      assert.equal(response.headers["x-astrolabe-initial-model"], "openai/gpt-5-nano");
      assert.equal(response.headers["x-astrolabe-final-model"], "openai/gpt-5-nano");
      assert.equal(response.body.choices[0].message.content, "Sunny and 72F.");
    });
  } finally {
    server.close();
  }
});

test("non-stream standard planning route uses MiniMax M2.5 headers", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await withAxiosStub(async (url, payload, options) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "planning",
                    complexity: "standard",
                    confidence: 5,
                    reason: "multi-step planning request",
                    matched_signals: ["plan"],
                    high_stakes: false
                  })
                }
              }
            ]
          }
        };
      }

      if (isSelfCheckPayload(payload)) {
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
      assert.equal(response.headers["x-astrolabe-initial-model"], "minimax/minimax-m2.5");
      assert.equal(response.headers["x-astrolabe-final-model"], "minimax/minimax-m2.5");
      assert.equal(response.body.choices[0].message.content, "Plan drafted.");
    });
  } finally {
    server.close();
  }
});

test("route retries next model when first routed model is unavailable", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const routedModelAttempts = [];

    await withAxiosStub(async (url, payload, options) => {
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
                    reason: "simple lookup",
                    matched_signals: ["lookup"],
                    high_stakes: false
                  })
                }
              }
            ]
          }
        };
      }

      if (isSelfCheckPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }

      routedModelAttempts.push(payload.model);
      if (payload.model === "openai/gpt-5-nano") {
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
      if (payload.model === "x-ai/grok-4.1-fast") {
        return {
          status: 200,
          data: {
            id: "chatcmpl-fallback",
            object: "chat.completion",
            created: 1,
            choices: [{ message: { role: "assistant", content: "Fallback succeeded." } }],
            usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 }
          }
        };
      }
      throw new Error(`Unexpected routed model call: ${payload.model}`);
    }, async () => {
      const response = await requestJson(port, {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          stream: false,
          messages: [{ role: "user", content: "Lookup my calendar event tomorrow." }]
        }
      });

      assert.equal(response.status, 200);
      assert.deepEqual(routedModelAttempts.slice(0, 2), ["openai/gpt-5-nano", "x-ai/grok-4.1-fast"]);
      assert.equal(response.headers["x-astrolabe-initial-model"], "x-ai/grok-4.1-fast");
      assert.equal(response.headers["x-astrolabe-final-model"], "x-ai/grok-4.1-fast");
      assert.equal(response.body.choices[0].message.content, "Fallback succeeded.");
    });
  } finally {
    server.close();
  }
});

test("multimodal route retries only multimodal-capable fallbacks first", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const routedModelAttempts = [];

    await withAxiosStub(async (url, payload, options) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "summarization",
                    complexity: "standard",
                    confidence: 5,
                    reason: "multimodal summarization",
                    matched_signals: ["summarize"],
                    high_stakes: false
                  })
                }
              }
            ]
          }
        };
      }

      if (isSelfCheckPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ score: 5, reason: "confident" }) } }]
          }
        };
      }

      routedModelAttempts.push(payload.model);
      if (payload.model === "moonshotai/kimi-k2.5") {
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
      if (payload.model === "google/gemini-3.1-pro-preview") {
        return {
          status: 200,
          data: {
            id: "chatcmpl-multimodal-fallback",
            object: "chat.completion",
            created: 1,
            choices: [{ message: { role: "assistant", content: "Multimodal fallback succeeded." } }],
            usage: { prompt_tokens: 14, completion_tokens: 7, total_tokens: 21 }
          }
        };
      }
      throw new Error(`Unexpected multimodal fallback call: ${payload.model}`);
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
      assert.deepEqual(routedModelAttempts.slice(0, 2), ["moonshotai/kimi-k2.5", "google/gemini-3.1-pro-preview"]);
      assert.equal(response.headers["x-astrolabe-initial-model"], "google/gemini-3.1-pro-preview");
      assert.equal(response.headers["x-astrolabe-final-model"], "google/gemini-3.1-pro-preview");
      assert.equal(response.body.choices[0].message.content, "Multimodal fallback succeeded.");
    });
  } finally {
    server.close();
  }
});

test("forced model bypasses classifier and self-check escalation", { concurrency: false }, async () => {
  const modulePath = require.resolve("../server");
  const cachedModule = require.cache[modulePath];
  const previousForceModel = process.env.ASTROLABE_FORCE_MODEL;
  let forcedApp = null;

  try {
    delete require.cache[modulePath];
    process.env.ASTROLABE_FORCE_MODEL = "openai/gpt-5-nano";
    ({ app: forcedApp } = require("../server"));
  } finally {
    if (previousForceModel == null) delete process.env.ASTROLABE_FORCE_MODEL;
    else process.env.ASTROLABE_FORCE_MODEL = previousForceModel;
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
  }

  const server = forcedApp.listen(0);
  try {
    const { port } = server.address();
    const routedModelAttempts = [];

    await withAxiosStub(async (url, payload, options) => {
      if (isClassifierPayload(payload)) {
        throw new Error("Classifier should be skipped when ASTROLABE_FORCE_MODEL is set.");
      }
      if (isSelfCheckPayload(payload)) {
        throw new Error("Self-check should be skipped when ASTROLABE_FORCE_MODEL is set.");
      }

      routedModelAttempts.push(payload.model);
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
      assert.deepEqual(routedModelAttempts, ["openai/gpt-5-nano"]);
      assert.equal(response.headers["x-astrolabe-route-label"], "FORCED");
      assert.equal(response.headers["x-astrolabe-initial-model"], "openai/gpt-5-nano");
      assert.equal(response.headers["x-astrolabe-final-model"], "openai/gpt-5-nano");
      assert.equal(response.headers["x-astrolabe-escalated"], "false");
      assert.equal(response.headers["x-astrolabe-confidence-score"], undefined);
      assert.equal(response.body.choices[0].message.content, "Forced model response.");
    });
  } finally {
    server.close();
  }
});

test("streaming requests passthrough SSE payload", { concurrency: false }, async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();

    await withAxiosStub(async (url, payload, options) => {
      if (isClassifierPayload(payload)) {
        return {
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "creative",
                    complexity: "simple",
                    confidence: 5,
                    reason: "small creative request",
                    matched_signals: ["creative"],
                    high_stakes: false
                  })
                }
              }
            ]
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
      assert.match(response.body, /data: \{"id":"chatcmpl-stream"/);
      assert.match(response.body, /data: \[DONE\]/);
    });
  } finally {
    server.close();
  }
});

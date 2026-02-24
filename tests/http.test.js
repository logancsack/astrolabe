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

function requestRaw(port, { method = "GET", path = "/", body, headers = {} }) {
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
      if (payload.model === "google/gemini-3-flash") {
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
      assert.deepEqual(routedModelAttempts.slice(0, 2), ["openai/gpt-5-nano", "google/gemini-3-flash"]);
      assert.equal(response.headers["x-astrolabe-initial-model"], "google/gemini-3-flash");
      assert.equal(response.headers["x-astrolabe-final-model"], "google/gemini-3-flash");
      assert.equal(response.body.choices[0].message.content, "Fallback succeeded.");
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

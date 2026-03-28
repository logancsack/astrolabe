const express = require("express");
const { createRuntime } = require("./runtime");
const { VERSION } = require("./version");

function extractInboundApiKey(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return String(req.headers["x-api-key"] || "").trim();
}

function createAstrolabeApp(config) {
  const runtime = createRuntime(config);
  const app = express();
  const rateLimitBuckets = new Map();
  let lastRateLimitCleanupAt = 0;
  const RATE_LIMIT_CLEANUP_INTERVAL_MS = 30_000;

  function maybeCleanupRateLimitBuckets(now) {
    if (now - lastRateLimitCleanupAt < RATE_LIMIT_CLEANUP_INTERVAL_MS) return;
    lastRateLimitCleanupAt = now;
    for (const [key, bucket] of rateLimitBuckets.entries()) {
      if (!bucket || Number(bucket.resetAt || 0) <= now) rateLimitBuckets.delete(key);
    }
  }

  function rateLimitKeyForRequest(req) {
    const inboundKey = extractInboundApiKey(req);
    if (inboundKey) return `api_key:${inboundKey}`;
    const remote = String(req.socket?.remoteAddress || req.ip || "unknown").trim();
    return `ip:${remote || "unknown"}`;
  }

  function applyRequestRateLimit(req, res, next) {
    if (!config.RATE_LIMIT_ENABLED) return next();
    const now = Date.now();
    maybeCleanupRateLimitBuckets(now);
    const key = rateLimitKeyForRequest(req);
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || Number(bucket.resetAt || 0) <= now) {
      bucket = { count: 0, resetAt: now + config.RATE_LIMIT_WINDOW_MS };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, config.RATE_LIMIT_MAX_REQUESTS - bucket.count);
    res.setHeader("x-ratelimit-limit", String(config.RATE_LIMIT_MAX_REQUESTS));
    res.setHeader("x-ratelimit-remaining", String(remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count <= config.RATE_LIMIT_MAX_REQUESTS) return next();
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("retry-after", String(retryAfterSeconds));
    return res.status(429).json({
      error: {
        message: "Rate limit exceeded. Try again later.",
        type: "rate_limit_error",
        code: "rate_limit_exceeded"
      }
    });
  }

  async function sendExecutionResult(req, res, executor) {
    const result = await executor(req, res);
    if (result?.data && typeof result.data.pipe === "function") {
      res.status(200);
      res.setHeader("Content-Type", result.headers?.["content-type"] || "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      req.on("close", () => {
        if (typeof result.data.destroy === "function") result.data.destroy();
      });
      result.data.pipe(res);
      return;
    }
    return res.status(200).json(result);
  }

  app.use(express.json({ limit: "4mb" }));

  app.use((req, res, next) => {
    if (!config.ASTROLABE_API_KEY) return next();
    const inboundKey = extractInboundApiKey(req);
    if (inboundKey === config.ASTROLABE_API_KEY) return next();
    return res.status(401).json({
      error: {
        message: "Unauthorized. Missing or invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key"
      }
    });
  });

  app.get("/health", (req, res) => {
    return res.status(200).json({
      ok: true,
      service: "astrolabe",
      version: VERSION,
      routing_profile: config.ROUTING_PROFILE,
      cost_efficiency_mode: config.COST_EFFICIENCY_MODE,
      default_profile: config.DEFAULT_PROFILE,
      responses_enabled: config.RESPONSES_ENABLED,
      chat_completions_enabled: config.CHAT_COMPLETIONS_ENABLED,
      safety_gate: config.ENABLE_SAFETY_GATE,
      rate_limit_enabled: config.RATE_LIMIT_ENABLED,
      rate_limit_window_ms: config.RATE_LIMIT_WINDOW_MS,
      rate_limit_max_requests: config.RATE_LIMIT_MAX_REQUESTS
    });
  });

  app.get("/v1/models", (req, res) => {
    const view = String(req.query.view || "virtual").trim().toLowerCase();
    return res.status(200).json(runtime.serializeModelList(view === "raw" ? "raw" : "virtual"));
  });

  app.get("/v1/lanes", (req, res) => {
    return res.status(200).json(runtime.serializeLaneList());
  });

  app.post("/v1/chat/completions", applyRequestRateLimit, async (req, res, next) => {
    try {
      if (!config.CHAT_COMPLETIONS_ENABLED) {
        const error = new Error("Chat Completions API is disabled.");
        error.status = 404;
        error.code = "chat_completions_disabled";
        throw error;
      }
      if (!req.body || !Array.isArray(req.body.messages)) {
        return res.status(400).json({
          error: {
            message: "Invalid request: 'messages' array is required.",
            type: "invalid_request_error",
            code: "missing_messages"
          }
        });
      }
      return sendExecutionResult(req, res, runtime.executeChatRequest);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/v1/responses", applyRequestRateLimit, async (req, res, next) => {
    try {
      if (!config.RESPONSES_ENABLED) {
        const error = new Error("Responses API is disabled.");
        error.status = 404;
        error.code = "responses_disabled";
        throw error;
      }
      if (!req.body || req.body.input == null) {
        return res.status(400).json({
          error: {
            message: "Invalid request: 'input' is required.",
            type: "invalid_request_error",
            code: "missing_input"
          }
        });
      }
      return sendExecutionResult(req, res, runtime.executeResponsesRequest);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (!error) return next();
    if (res.headersSent) return next(error);
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({
        error: {
          message: "Invalid request: body must be valid JSON.",
          type: "invalid_request_error",
          code: "invalid_json"
        }
      });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({
        error: {
          message: "Invalid request: payload is too large.",
          type: "invalid_request_error",
          code: "payload_too_large"
        }
      });
    }
    const rawStatus = Number(error?.status || error?.statusCode) || 500;
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    return res.status(status).json(runtime.buildErrorBody(status, error));
  });

  function startServer() {
    if (!config.OPENROUTER_API_KEY) {
      console.error("Missing OPENROUTER_API_KEY. Set it in your environment and restart.");
      process.exit(1);
    }
    const isProduction = String(process.env.NODE_ENV || "")
      .trim()
      .toLowerCase() === "production";
    if (isProduction && !config.ASTROLABE_API_KEY) {
      console.error("Missing ASTROLABE_API_KEY in production. Refusing to start unauthenticated public endpoint.");
      process.exit(1);
    }
    if (!config.ASTROLABE_API_KEY) {
      console.warn("Warning: ASTROLABE_API_KEY is not set. Your public endpoint is unauthenticated.");
    }
    app.listen(config.PORT, () => {
      console.log(`Astrolabe listening on port ${config.PORT}`);
    });
  }

  return {
    app,
    config,
    internals: runtime.internals,
    startServer
  };
}

module.exports = {
  createAstrolabeApp,
  extractInboundApiKey
};

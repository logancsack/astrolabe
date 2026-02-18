/*
  Astrolabe: headless OpenAI-compatible cost router for OpenClaw.

  Core problem this solves:
  OpenClaw runs 24/7 (heartbeats, scheduled tasks, tool calls, long context history),
  and many setups route everything to expensive frontier models. That can easily create
  $100-$1000+ monthly bills for mostly simple traffic. Astrolabe sits between OpenClaw
  and OpenRouter so most requests are routed to ultra-cheap models automatically, while
  still escalating hard tasks to premium models when needed.

  Name origin:
  An astrolabe is a historical navigation tool. This proxy "navigates" each request to
  the cheapest effective model.
*/

const crypto = require("crypto");
const express = require("express");
const axios = require("axios");
require("dotenv").config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ASTROLABE_API_KEY = (process.env.ASTROLABE_API_KEY || "").trim();
const PORT = Number(process.env.PORT) || 3000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

if (!OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY. Set it in your environment and restart.");
  process.exit(1);
}

const tierModels = {
  TIER0: "openai/gpt-5-nano",
  TIER1: "x-ai/grok-4.1-fast",
  TIER2: "anthropic/claude-opus-4.6"
};

const pricePer1M = {
  "openai/gpt-5-nano": { input: 0.05, output: 0.4 },
  "x-ai/grok-4.1-fast": { input: 0.2, output: 0.5 },
  // Approximate placeholder for Feb 2026. Update as pricing changes.
  "anthropic/claude-opus-4.6": { input: 15, output: 75 }
};

const app = express();
app.use(express.json({ limit: "2mb" }));

function extractInboundApiKey(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  return xApiKey;
}

app.use((req, res, next) => {
  // If ASTROLABE_API_KEY is configured, every request must send it.
  if (!ASTROLABE_API_KEY) return next();
  const inboundKey = extractInboundApiKey(req);
  if (inboundKey === ASTROLABE_API_KEY) return next();
  return res.status(401).json({
    error: {
      message: "Unauthorized. Missing or invalid API key.",
      type: "authentication_error",
      code: "invalid_api_key"
    }
  });
});

function safeText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (typeof item.text === "string") return item.text;
        if (item.type === "text" && typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function extractLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === "user") {
      const text = safeText(msg.content).trim();
      if (text) return text;
    }
  }
  return "";
}

function buildRecentContext(messages, maxMessages = 6, maxChars = 1400) {
  const slice = messages.slice(-maxMessages);
  const packed = slice
    .map((msg) => {
      const role = msg?.role || "unknown";
      const text = safeText(msg?.content).replace(/\s+/g, " ").trim();
      return `${role}: ${text.slice(0, 240)}`;
    })
    .join("\n");
  return packed.slice(0, maxChars);
}

function parseTierLine(text) {
  const match = text.match(/\b(TIER0|TIER1|TIER2)\b\s*:\s*(.{1,140})/i);
  if (match) return { tier: match[1].toUpperCase(), reason: match[2].trim() };
  const tierOnly = text.match(/\b(TIER0|TIER1|TIER2)\b/i);
  if (tierOnly) return { tier: tierOnly[1].toUpperCase(), reason: "Tier returned without reason." };
  return null;
}

function parseSelfCheckLine(text) {
  const match = text.match(/\b(Yes|No)\b\s*:\s*(.{1,160})/i);
  if (match) return { confident: match[1].toLowerCase() === "yes", reason: match[2].trim() };
  const yesNo = text.match(/\b(Yes|No)\b/i);
  if (yesNo) return { confident: yesNo[1].toLowerCase() === "yes", reason: "Self-check returned without reason." };
  return null;
}

function makeOpenRouterHeaders() {
  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) headers["X-Title"] = process.env.OPENROUTER_APP_NAME;
  return headers;
}

async function callOpenRouter(payload) {
  try {
    const response = await axios.post(OPENROUTER_URL, payload, {
      headers: makeOpenRouterHeaders(),
      timeout: 90000,
      validateStatus: () => true
    });
    if (response.status >= 200 && response.status < 300) return response.data;

    const message =
      response.data?.error?.message ||
      response.data?.message ||
      `OpenRouter request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = response.data?.error?.code;
    error.upstream = response.data;
    throw error;
  } catch (error) {
    if (error.status) throw error;
    const networkError = new Error(`OpenRouter network error: ${error.message}`);
    networkError.status = 502;
    networkError.upstream = { error: { message: networkError.message } };
    throw networkError;
  }
}

async function classifyTier(lastUserMessage, recentContext) {
  const classifierPrompt = [
    "You are Astrolabe's strict routing classifier.",
    "Choose the cheapest tier that can solve the request reliably.",
    "Output exactly one line in this format:",
    "TIER0|TIER1|TIER2 : one short reason",
    "No extra words."
  ].join("\n");

  const payload = {
    model: tierModels.TIER0,
    temperature: 0,
    max_tokens: 30,
    messages: [
      { role: "system", content: classifierPrompt },
      {
        role: "user",
        content:
          `Last user message:\n${lastUserMessage || "(none)"}\n\n` +
          `Recent context:\n${recentContext || "(none)"}`
      }
    ]
  };

  try {
    const response = await callOpenRouter(payload);
    const raw = safeText(response?.choices?.[0]?.message?.content).trim();
    const parsed = parseTierLine(raw);
    if (parsed) return parsed;
    return { tier: "TIER1", reason: "Classifier output parse fallback." };
  } catch (error) {
    return { tier: "TIER1", reason: `Classifier error fallback: ${error.message.slice(0, 120)}` };
  }
}

async function runSelfCheck(lastUserMessage, assistantText) {
  const checkPrompt = [
    "You are Astrolabe's strict answer quality checker.",
    "Is the answer complete, correct, and confident for the user's request?",
    "Output exactly one line:",
    "Yes|No : one short reason",
    "No extra words."
  ].join("\n");

  const payload = {
    model: tierModels.TIER0,
    temperature: 0,
    max_tokens: 30,
    messages: [
      { role: "system", content: checkPrompt },
      {
        role: "user",
        content:
          `User request:\n${lastUserMessage || "(none)"}\n\n` +
          `Assistant answer:\n${assistantText || "(empty)"}`
      }
    ]
  };

  try {
    const response = await callOpenRouter(payload);
    const raw = safeText(response?.choices?.[0]?.message?.content).trim();
    const parsed = parseSelfCheckLine(raw);
    if (parsed) return parsed;
    return { confident: true, reason: "Self-check parse fallback (treated as Yes)." };
  } catch (error) {
    return { confident: true, reason: `Self-check skipped: ${error.message.slice(0, 120)}` };
  }
}

function estimateCost(model, usage) {
  const pricing = pricePer1M[model];
  if (!pricing || !usage) return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
  const usd = (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
  return { promptTokens, completionTokens, totalTokens, usd };
}

function buildErrorBody(status, err) {
  const upstreamMessage = err?.upstream?.error?.message || err?.message || "Unknown error";
  const exposeMessage = status >= 500 ? "Internal server error." : upstreamMessage;
  return {
    error: {
      message: exposeMessage,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: err?.code || err?.upstream?.error?.code
    }
  };
}

app.post("/v1/chat/completions", async (req, res) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let tier = "TIER1";
  let chosenModel = tierModels.TIER1;
  let classifierReason = "Not classified.";

  try {
    const body = req.body;
    if (!body || !Array.isArray(body.messages)) {
      return res.status(400).json({ error: { message: "Invalid request: 'messages' array is required.", type: "invalid_request_error" } });
    }
    if (body.stream === true) {
      // TODO: Add streaming proxy support in a future release.
      return res.status(400).json({ error: { message: "Streaming is not supported in Astrolabe MVP. Send stream=false.", type: "invalid_request_error" } });
    }

    const lastUserMessage = extractLastUserMessage(body.messages);
    const recentContext = buildRecentContext(body.messages);
    const classified = await classifyTier(lastUserMessage, recentContext);
    tier = classified.tier;
    classifierReason = classified.reason;
    chosenModel = tierModels[tier] || tierModels.TIER1;

    let finalResponse = await callOpenRouter({ ...body, model: chosenModel });
    let finalModel = chosenModel;
    let escalated = false;
    const firstAnswer = safeText(finalResponse?.choices?.[0]?.message?.content);
    const selfCheck = await runSelfCheck(lastUserMessage, firstAnswer);

    if (!selfCheck.confident && chosenModel !== tierModels.TIER2) {
      escalated = true;
      finalModel = tierModels.TIER2;
      finalResponse = await callOpenRouter({ ...body, model: finalModel });
    }

    if (!finalResponse || !Array.isArray(finalResponse.choices)) {
      const malformed = new Error("Malformed OpenRouter response.");
      malformed.status = 502;
      throw malformed;
    }

    const cost = estimateCost(finalModel, finalResponse.usage) || {};
    const latency = Date.now() - startedAt;
    console.log(
      `[${requestId}] tier=${tier} chosen_model=${chosenModel} final_model=${finalModel} reason="${classifierReason}" ` +
        `selfcheck=${selfCheck.confident ? "Yes" : "No"} self_reason="${selfCheck.reason}" escalated=${escalated} ` +
        `tokens=${cost.promptTokens ?? "n/a"}/${cost.completionTokens ?? "n/a"}/${cost.totalTokens ?? "n/a"} ` +
        `est_usd=${typeof cost.usd === "number" ? cost.usd.toFixed(6) : "n/a"} latency_ms=${latency}`
    );

    return res.status(200).json(finalResponse);
  } catch (err) {
    const rawStatus = Number(err?.status) || 500;
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const latency = Date.now() - startedAt;
    const upstreamMessage = err?.upstream?.error?.message || err?.message || "Unknown error";
    console.error(
      `[${requestId}] error status=${status} tier=${tier} model=${chosenModel} reason="${classifierReason}" ` +
        `message="${upstreamMessage}" latency_ms=${latency}`
    );
    return res.status(status).json(buildErrorBody(status, err));
  }
});

app.listen(PORT, () => {
  if (!ASTROLABE_API_KEY) {
    console.warn("Warning: ASTROLABE_API_KEY is not set. Your public endpoint is unauthenticated.");
  }
  console.log(`Astrolabe listening on port ${PORT}`);
});

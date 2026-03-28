const axios = require("axios");

function makeOpenRouterHeaders(config) {
  if (!config.OPENROUTER_API_KEY) {
    const error = new Error("Missing OPENROUTER_API_KEY.");
    error.status = 500;
    error.code = "missing_openrouter_api_key";
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };
  if (config.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = config.OPENROUTER_SITE_URL;
  if (config.OPENROUTER_APP_NAME) headers["X-Title"] = config.OPENROUTER_APP_NAME;
  return headers;
}

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postJson(url, payload, config, { stream = false } = {}) {
  try {
    const response = await axios.post(url, payload, {
      headers: makeOpenRouterHeaders(config),
      timeout: stream ? 0 : 90_000,
      responseType: stream ? "stream" : "json",
      validateStatus: () => true
    });
    if (response.status >= 200 && response.status < 300) return stream ? response : response.data;

    let parsed = response.data;
    if (stream) {
      const rawBody = await streamToText(response.data);
      parsed = tryParseJson(rawBody) || { error: { message: rawBody } };
    }
    const message =
      parsed?.error?.message ||
      parsed?.message ||
      `OpenRouter request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = parsed?.error?.code || parsed?.code;
    error.upstream = parsed;
    throw error;
  } catch (error) {
    if (error.status) throw error;
    const networkError = new Error(`OpenRouter network error: ${error.message}`);
    networkError.status = 502;
    networkError.upstream = { error: { message: networkError.message } };
    throw networkError;
  }
}

async function callOpenRouterChat(payload, config) {
  return postJson(`${config.OPENROUTER_BASE_URL}/chat/completions`, payload, config);
}

async function callOpenRouterChatStream(payload, config) {
  return postJson(`${config.OPENROUTER_BASE_URL}/chat/completions`, payload, config, { stream: true });
}

async function callOpenRouterResponses(payload, config) {
  return postJson(`${config.OPENROUTER_BASE_URL}/responses`, payload, config);
}

async function callOpenRouterResponsesStream(payload, config) {
  return postJson(`${config.OPENROUTER_BASE_URL}/responses`, payload, config, { stream: true });
}

function isRetryableModelError(error) {
  const status = Number(error?.status || 0);
  if ([408, 409, 422, 429, 500, 502, 503, 504].includes(status)) return true;
  if (status === 404) return true;
  if (status === 400) {
    const message = String(error?.message || error?.upstream?.error?.message || "").toLowerCase();
    if (/(model|provider|unsupported|not found|capacity|overloaded|temporarily unavailable|responses api beta)/.test(message)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  callOpenRouterChat,
  callOpenRouterChatStream,
  callOpenRouterResponses,
  callOpenRouterResponsesStream,
  isRetryableModelError,
  makeOpenRouterHeaders,
  streamToText,
  tryParseJson
};

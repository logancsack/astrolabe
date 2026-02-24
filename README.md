# Astrolabe 0.2.0 Beta

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![OpenRouter](https://img.shields.io/badge/uses-OpenRouter-orange)
![Version](https://img.shields.io/badge/version-0.2.0--beta.1-b8860b)

Policy-driven OpenAI-compatible routing proxy for OpenClaw.

Astrolabe sits between OpenClaw and OpenRouter, classifies each request, applies safety gates, routes to the cheapest safe model, and escalates once when confidence is low.

## What's new in 0.2.0-beta.1

1. 12-category request routing policy (`heartbeat`, `core_loop`, `retrieval`, `summarization`, `planning`, `orchestration`, `coding`, `research`, `creative`, `communication`, `high_stakes`, `reflection`).
2. Pre-classification high-stakes safety gate.
3. Category + complexity classifier with heuristic fallback.
4. Model fallback chains when upstream model/provider is unavailable.
5. Confidence-scored self-check (1-5) with one-step escalation policy.
6. Routing metadata headers on responses.
7. `/health` endpoint.

## Default model roster

```js
const MODELS = {
  opus: "anthropic/claude-opus-4.6",
  sonnet: "anthropic/claude-sonnet-4.6",
  grok: "x-ai/grok-4.1-fast",
  nano: "openai/gpt-5-nano",
  dsCoder: "deepseek/deepseek-v3.2-coder",
  gemFlash: "google/gemini-3-flash",
  gem31Pro: "google/gemini-3.1-pro-preview"
};
```

## Routing pipeline

1. Parse request + recent context.
2. Run safety gate (high-stakes keyword/action detection).
3. Classify `category` + `complexity` using a cheap model (with heuristics fallback).
4. Resolve route policy to a primary model.
5. Execute request with model fallback chain.
6. For non-stream requests: run cheap self-check (score 1-5), escalate once if needed.
7. Return response with Astrolabe routing headers.

## Self-check and escalation policy

1. Score >= 4: keep current model response.
2. Score 2-3: escalate one policy step up and rerun once.
3. Score 1: escalate directly to Opus.
4. Max one escalation per request.
5. If final score remains low, response is returned with `x-astrolabe-low-confidence: true`.

## Quick start

### 1) Install dependencies

```bash
cd Astrolabe
npm install
```

### 2) Configure environment

Copy `.env.example` to `.env` and set at least:

```env
OPENROUTER_API_KEY=your_real_key_here
ASTROLABE_API_KEY=your_proxy_secret
PORT=3000
```

### 3) Run

```bash
npm start
```

Server starts at `http://localhost:3000`.

### 4) Smoke test

```bash
curl -X POST http://localhost:3000/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer your_proxy_secret" ^
  -d "{\"model\":\"ignored-by-astrolabe\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one line.\"}]}"
```

`model` in the request is accepted for compatibility, but Astrolabe overrides it with routed policy selection unless `ASTROLABE_FORCE_MODEL` is set.

## Optional routing configuration

```env
# balanced | budget | quality
ASTROLABE_ROUTING_PROFILE=balanced

# true | false
ASTROLABE_ENABLE_SAFETY_GATE=true

# prompt | strict | off
ASTROLABE_HIGH_STAKES_CONFIRM_MODE=prompt
ASTROLABE_HIGH_STAKES_CONFIRM_TOKEN=confirm

# allow Sonnet floor for high-stakes when routing profile is budget
ASTROLABE_ALLOW_HIGH_STAKES_BUDGET_FLOOR=false

# override classifier/self-check cheap models
ASTROLABE_CLASSIFIER_MODEL_KEY=nano
ASTROLABE_SELF_CHECK_MODEL_KEY=nano

# classifier context window
ASTROLABE_CONTEXT_MESSAGES=8
ASTROLABE_CONTEXT_CHARS=2500

# hard override all routing (full model id)
ASTROLABE_FORCE_MODEL=
```

## Safety gate behavior

- `prompt` mode: high-stakes requests are force-routed and a safety system policy prompt is injected.
- `strict` mode: high-stakes requests require exact confirmation token match (`x-astrolabe-confirmed: <token>` or `metadata.astrolabe_confirmed: "<token>"`).
- `off` mode: no special confirmation handling.

## Response headers

Astrolabe adds:

- `x-astrolabe-category`
- `x-astrolabe-complexity`
- `x-astrolabe-adjusted-complexity`
- `x-astrolabe-initial-model`
- `x-astrolabe-final-model`
- `x-astrolabe-route-label`
- `x-astrolabe-escalated`
- `x-astrolabe-confidence-score`
- `x-astrolabe-low-confidence`
- `x-astrolabe-safety-gate`

## OpenClaw integration

Point OpenClaw OpenAI-compatible base URL at Astrolabe:

1. Before: `https://openrouter.ai/api/v1`
2. After (local): `http://localhost:3000/v1`
3. After (deploy): `https://your-host/v1`

Set OpenClaw API key to the same value as `ASTROLABE_API_KEY`.

## Test

```bash
npm test
```

## Troubleshooting

1. `Missing OPENROUTER_API_KEY`
   - Set key in `.env` and restart.
2. `high_stakes_confirmation_required`
   - In strict mode, include the exact configured token in header/body.
3. Frequent escalations
   - Increase routing profile quality or tighten category prompts.
4. `est_usd=n/a`
   - Upstream omitted token usage.

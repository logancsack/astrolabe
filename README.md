# Astrolabe 0.3.0 Beta

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![OpenRouter](https://img.shields.io/badge/uses-OpenRouter-orange)
![Version](https://img.shields.io/badge/version-0.3.0--beta.0-b8860b)

Astrolabe is an OpenClaw-first AI gateway for self-hosted agents.

It sits between OpenClaw and OpenRouter, keeps a static checked-in roster, routes each turn onto the right lane, adds safety policy around tool use, and exposes a simple virtual model surface so users do not need to hand-tune providers or model IDs turn by turn.

## What changed in 0.3

- `POST /v1/responses` is now the primary API.
- `POST /v1/chat/completions` remains as a compatibility adapter.
- `m27` is now the default workhorse.
- `m25` is now strict-budget, overflow, and fallback only.
- Virtual models are first-class:
  - `astrolabe/auto`
  - `astrolabe/coding`
  - `astrolabe/research`
  - `astrolabe/vision`
  - `astrolabe/strict-json`
  - `astrolabe/cheap`
  - `astrolabe/safe`
- Static manifests replaced the old single hardcoded `MODELS` object.

## Why Astrolabe exists

OpenClaw agents do better when the AI layer owns four things centrally:

- routing flexibility
- reliability and fallback behavior
- cost control
- safety policy for tool use and untrusted inputs

Astrolabe provides those without adding a database, a hosted control plane, or any SaaS dependency.

This repo is for **Astrolabe OSS** only:

- self-hosted
- stateless
- user supplies `OPENROUTER_API_KEY`
- user supplies `ASTROLABE_API_KEY`
- OpenClaw points at the Astrolabe instance

## Default runtime shape

1. OpenClaw sends `POST /v1/responses` to Astrolabe.
2. Astrolabe classifies category, complexity, and modifiers.
3. Astrolabe resolves a lane and candidate model set from static manifests.
4. Astrolabe executes against OpenRouter.
5. Astrolabe verifies non-stream responses, applies tool policy checks, and may escalate once.
6. Astrolabe returns the upstream response plus `x-astrolabe-*` headers and inline Astrolabe metadata.

## Static model roster

Core production roster:

- `m27` -> `minimax/minimax-m2.7`
- `m25` -> `minimax/minimax-m2.5`
- `kimiK25` -> `moonshotai/kimi-k2.5`
- `kimiThinking` -> `moonshotai/kimi-k2-thinking`
- `glm47Flash` -> `z-ai/glm-4.7-flash`
- `glm5` -> `z-ai/glm-5`
- `grok` -> `x-ai/grok-4.1-fast`
- `dsCoder` -> `deepseek/deepseek-v3.2`
- `qwen35Flash` -> `qwen/qwen3.5-flash-02-23`
- `qwen35Plus` -> `qwen/qwen3.5-plus-02-15`
- `qwenCoderNext` -> `qwen/qwen3-coder-next`
- `gpt54` -> `openai/gpt-5.4`
- `gpt54Mini` -> `openai/gpt-5.4-mini`
- `gpt5Nano` -> `openai/gpt-5-nano`
- `gpt54Nano` -> `openai/gpt-5.4-nano`
- `gem25FlashLite` -> `google/gemini-2.5-flash-lite`
- `gem31FlashLite` -> `google/gemini-3.1-flash-lite-preview`
- `gem25Pro` -> `google/gemini-2.5-pro`
- `gem31Pro` -> `google/gemini-3.1-pro-preview`
- `grok420Beta` -> `x-ai/grok-4.20-beta`
- `sonnet` -> `anthropic/claude-sonnet-4.6`
- `opus` -> `anthropic/claude-opus-4.6`

Compatibility aliases:

- `nano` -> `gpt5Nano`
- `mini` -> `gpt54Mini`
- `gemFlash` -> `gem25FlashLite`

## Routing defaults

- `astrolabe/auto`: category-driven with `m27` as the main non-trivial default
- `astrolabe/coding`: `m27 -> qwenCoderNext -> glm5 -> sonnet -> opus`
- `astrolabe/research`: `qwen35Plus -> kimiThinking -> m27 -> grok420Beta -> sonnet -> opus`
- `astrolabe/vision`: `kimiK25 -> qwen35Plus -> gem25Pro -> gem31Pro -> sonnet`
- `astrolabe/strict-json`: `glm47Flash -> glm5 -> gpt54Mini -> gpt54 -> sonnet`
- `astrolabe/cheap`: `qwen35Flash -> grok -> m25 -> dsCoder -> gpt5Nano`
- `astrolabe/safe`: `sonnet -> opus -> gpt54`

Policy rules worth knowing:

- `m27` is the workhorse for serious OpenClaw turns.
- `m25` is only used for strict-budget, fallback, or overflow scenarios.
- Multimodal turns promote to the vision lane.
- Tool availability alone does not imply `strict-json`.
- Explicit structured output, schema-safe tool arguments, or repair flows promote to `glm47Flash` / `glm5`.
- Tool-enabled requests with untrusted content cannot stay on weak cheap tiers.

## API surface

Public endpoints:

- `GET /health`
- `GET /v1/models`
- `GET /v1/lanes`
- `POST /v1/responses`
- `POST /v1/chat/completions`

`GET /v1/models` returns virtual models by default.

Use `GET /v1/models?view=raw` to inspect the underlying static roster.

## Quick start

### 1. Install

```bash
npm install
```

### 2. Configure

Copy `.env.example` to `.env` and set:

```env
OPENROUTER_API_KEY=your_real_key_here
ASTROLABE_API_KEY=your_proxy_secret
PORT=3000
```

Generate an inbound key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start

```bash
npm start
```

### 4. Health check

```bash
curl http://localhost:3000/health \
  -H "Authorization: Bearer your_proxy_secret"
```

### 5. Test the primary Responses API

```bash
curl -X POST http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_proxy_secret" \
  -d '{"model":"astrolabe/auto","input":"Write a one-line greeting.","stream":false}'
```

### 6. OpenClaw setup

Point OpenClaw at Astrolabe as a custom provider:

- base URL: `http://localhost:3000/v1`
- API type: `openai-responses`
- model: `astrolabe/auto`
- API key: same value as `ASTROLABE_API_KEY`

## Environment variables

Core:

- `OPENROUTER_API_KEY`
- `ASTROLABE_API_KEY`
- `PORT`

Primary runtime controls:

- `ASTROLABE_RESPONSES_ENABLED`
- `ASTROLABE_CHAT_COMPLETIONS_ENABLED`
- `ASTROLABE_ROUTING_PROFILE`
- `ASTROLABE_COST_EFFICIENCY_MODE`
- `ASTROLABE_DEFAULT_PROFILE`
- `ASTROLABE_ENABLE_SAFETY_GATE`
- `ASTROLABE_HIGH_STAKES_CONFIRM_MODE`
- `ASTROLABE_HIGH_STAKES_CONFIRM_TOKEN`
- `ASTROLABE_RESPONSES_FILES_URL_ALLOWLIST`
- `ASTROLABE_RESPONSES_IMAGES_URL_ALLOWLIST`
- `ASTROLABE_RESPONSES_MAX_URL_PARTS`
- `ASTROLABE_RATE_LIMIT_ENABLED`
- `ASTROLABE_RATE_LIMIT_WINDOW_MS`
- `ASTROLABE_RATE_LIMIT_MAX_REQUESTS`
- `ASTROLABE_FORCE_MODEL`

## Response transparency

Astrolabe adds routing headers:

- `x-astrolabe-category`
- `x-astrolabe-complexity`
- `x-astrolabe-adjusted-complexity`
- `x-astrolabe-lane`
- `x-astrolabe-initial-model`
- `x-astrolabe-final-model`
- `x-astrolabe-route-label`
- `x-astrolabe-escalated`
- `x-astrolabe-confidence-score`
- `x-astrolabe-low-confidence`
- `x-astrolabe-safety-gate`

Non-stream JSON responses also include inline Astrolabe metadata.

## Validation

Run tests:

```bash
npm test
```

Validate the static manifest against OpenRouter’s current catalog:

```bash
npm run validate:models
```

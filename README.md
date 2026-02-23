# Astrolabe

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![OpenRouter](https://img.shields.io/badge/uses-OpenRouter-orange)

**Smart model routing for OpenClaw - 70-95% cheaper without losing quality.**

Astrolabe is a headless OpenAI-compatible proxy server for OpenClaw agents.

It sits between OpenClaw and OpenRouter, then auto-routes each request to the cheapest effective model tier. This usually cuts agent costs by **70-95%** for always-on workloads while still escalating difficult tasks to premium models when needed.

## Why this saves money

OpenClaw often sends frequent low-value requests (heartbeats, status checks, light formatting, simple classification) to expensive models by default.

Astrolabe fixes that by:
1. Classifying each request with an ultra-cheap model.
2. Routing trivial/moderate tasks to cheap tiers.
3. Escalating to a premium model only when needed.
4. Running a cheap self-check and escalating once if confidence is low.

## Routing tiers (default)

```js
const tierModels = {
  TIER0: "openai/gpt-5-nano",
  TIER1: "x-ai/grok-4.1-fast",
  TIER2: "anthropic/claude-opus-4.6"
};
```

## Quick start (local)

## 1) Install Node.js
Install the latest LTS from https://nodejs.org (Node 20+ recommended).

## 2) Open terminal and install dependencies
```bash
cd astrolabe
npm install
```

## 3) Create environment file
Copy `.env.example` to `.env` and set your key:

```env
OPENROUTER_API_KEY=your_real_key_here
ASTROLABE_API_KEY=your_long_random_proxy_secret
PORT=3000
```

## 4) Run Astrolabe
```bash
node server.js
```

Or:

```bash
npm start
```

Server will listen on `http://localhost:3000`.

## Get your OpenRouter API key

1. Go to https://openrouter.ai
2. Create an account or sign in.
3. Open API Keys.
4. Create a new key.
5. Paste it into `.env` as `OPENROUTER_API_KEY`.

## Test endpoint with curl

```bash
curl -X POST http://localhost:3000/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer your_long_random_proxy_secret" ^
  -d "{\"model\":\"ignored-by-astrolabe\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one line.\"}]}"
```

Note: `model` in request is accepted, but Astrolabe overrides it with the selected tier model.

## Connect OpenClaw to Astrolabe

Point OpenClaw's OpenAI-compatible base URL to your Astrolabe host.
Set OpenClaw's API key to the exact same value as `ASTROLABE_API_KEY` so Astrolabe accepts the request.

Example:
1. Before: `https://openrouter.ai/api/v1`
2. After local: `http://localhost:3000/v1`
3. After deploy: `https://your-app-name.up.railway.app/v1`

OpenClaw should continue using standard `chat/completions` without code changes.

## Deploy to Railway (about 5 minutes)

1. Push `Astrolabe/` to a GitHub repo (or keep it in a monorepo).
2. Go to https://railway.app and create a new project.
3. Choose Deploy from GitHub and select your repo.
4. Railway usually auto-detects the root for this project.
5. If your repo has multiple projects, set Root Directory to `Astrolabe`.
6. Add environment variable:
   - `OPENROUTER_API_KEY=...`
   - `ASTROLABE_API_KEY=...` (long random secret)
7. Deploy.
8. Railway will detect Node.js automatically and run `npm start`.
9. Copy your public URL and use it as OpenClaw's base URL.

## Example logs screenshot

Add a screenshot named `example-logs.png` in the repo root to show routing and occasional escalation, then reference it like this:

```md
![Astrolabe routing logs](./example-logs.png)
```

## API behavior and compatibility

1. Endpoint: `POST /v1/chat/completions`
2. Input: OpenAI-compatible chat completion payload.
3. Output: OpenRouter response passthrough (`id`, `object`, `created`, `choices`, `usage`, etc).
4. Streaming: supported. If `stream` is omitted, Astrolabe defaults to `stream: true`.
5. Non-stream mode: send `stream: false` to use full JSON responses and Astrolabe's self-check/escalation step.
6. Authentication: set `ASTROLABE_API_KEY` to require `Authorization: Bearer <key>` (or `x-api-key`).

## Security for public deployments

If your Railway URL is public, set `ASTROLABE_API_KEY` so random users cannot spend your OpenRouter balance.

Minimum secure setup:
1. Generate a long random string for `ASTROLABE_API_KEY`.
2. Add it as a Railway environment variable.
3. Put the same string into OpenClaw's API key field.
4. Rotate your OpenRouter key if you ever exposed it.

## Logs and observability

For every successful request, Astrolabe logs:
1. Tier
2. Chosen model
3. Classifier reason
4. Self-check result and reason
5. Escalation status
6. Prompt/completion/total tokens
7. Estimated USD cost
8. Latency

Errors include upstream status/message and request ID context.

## Customize models and behavior

Edit `server.js`:
1. `tierModels` to swap models.
2. `pricePer1M` for updated pricing.
3. `classifyTier` prompt to tighten/loosen tier behavior.
4. `runSelfCheck` prompt or escalation policy.

## Expected savings

Typical persistent-agent savings are **70-95%**, depending on:
1. How often your workload is trivial vs complex.
2. Average context length.
3. How often requests escalate to TIER2.

## Troubleshooting

1. `Missing OPENROUTER_API_KEY`
   - Add key to `.env` and restart.
2. Need non-stream JSON output
   - Send `stream: false` explicitly.
3. Upstream errors from OpenRouter
   - Check key validity, credits, model availability, and request format.
4. `est_usd=n/a`
   - Some providers may omit usage fields; cost estimate needs token usage.

## Files in this project

1. `package.json` - project metadata, dependencies, start script.
2. `.env.example` - required environment variables.
3. `server.js` - proxy logic, routing, self-check, escalation, logging.
4. `README.md` - setup, deployment, and customization guide.

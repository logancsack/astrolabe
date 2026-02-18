# Astrolabe

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
cd Astrolabe
npm install
```

## 3) Create environment file
Copy `.env.example` to `.env` and set your key:

```env
OPENROUTER_API_KEY=your_real_key_here
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
  -d "{\"model\":\"ignored-by-astrolabe\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one line.\"}]}"
```

Note: `model` in request is accepted, but Astrolabe overrides it with the selected tier model.

## Connect OpenClaw to Astrolabe

Point OpenClaw's OpenAI-compatible base URL to your Astrolabe host.

Example:
1. Before: `https://openrouter.ai/api/v1`
2. After local: `http://localhost:3000/v1`
3. After deploy: `https://your-app-name.up.railway.app/v1`

OpenClaw should continue using standard `chat/completions` without code changes.

## Deploy to Railway (about 5 minutes)

1. Push `Astrolabe/` to a GitHub repo (or keep it in a monorepo).
2. Go to https://railway.app and create a new project.
3. Choose Deploy from GitHub and select your repo.
4. Set Root Directory to `Astrolabe` if needed.
5. Add environment variable:
   - `OPENROUTER_API_KEY=...`
6. Deploy.
7. Railway will detect Node.js automatically and run `npm start`.
8. Copy your public URL and use it as OpenClaw's base URL.

## API behavior and compatibility

1. Endpoint: `POST /v1/chat/completions`
2. Input: OpenAI-compatible chat completion payload.
3. Output: OpenRouter response passthrough (`id`, `object`, `created`, `choices`, `usage`, etc).
4. Streaming: not supported in MVP. `stream: true` returns HTTP 400.

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
2. `Streaming is not supported`
   - Send `stream: false` or omit `stream`.
3. Upstream errors from OpenRouter
   - Check key validity, credits, model availability, and request format.
4. `est_usd=n/a`
   - Some providers may omit usage fields; cost estimate needs token usage.

## Files in this project

1. `package.json` - project metadata, dependencies, start script.
2. `.env.example` - required environment variables.
3. `server.js` - proxy logic, routing, self-check, escalation, logging.
4. `README.md` - setup, deployment, and customization guide.

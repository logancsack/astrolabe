# Engineering verification

## Fresh checkout or worktree

```bash
git fetch origin main
git worktree add -b fix/your-change ../astrolabe-your-change origin/main
cd ../astrolabe-your-change
npm ci
npm test
npm run validate:models
```

Give each worktree its own dependencies. Tests use ephemeral loopback ports, so multiple worktrees can run independently. No `.env`, OpenRouter key, production key, browser, or database is needed for tests. CI uses Node 20; the September 2026 audit also verified Node 22. Use the same Node version for before/after benchmarks.

After the branch is merged and its files are clean, remove the worktree with `git worktree remove ../astrolabe-your-change` from another checkout.

## Short feedback loops

```bash
npm run test:routing
npm run test:http
node --test --test-name-pattern='disconnects' tests/streaming.test.js
npm run check
```

Routing tests call `createRuntime(createConfig({...}))`; HTTP tests call `createAstrolabeApp(createConfig({...}))`. Never reload `server.js` or mutate `process.env` to change test configuration: that imports dotenv and lets an agent's shell settings alter the tests. The `server.js` entry point remains the production bootstrap.

`tests/http.test.js` stubs Axios for routing, fallback, schema recovery, and policy scenarios. Its stubs run serially within that test file. `tests/streaming.test.js` uses the real Axios HTTP transport and a local upstream server to prove incremental SSE delivery, cancellation, and failed-stream cleanup for both API surfaces. These tests close their servers and use bounded timeouts. Keep both layers: buffered mocks cannot verify socket lifetime.

For interactive debugging, run `node --inspect-brk --test tests/streaming.test.js` and attach a Node debugger. Keep debugger ports bound to loopback.

## Performance evidence

```bash
npm run benchmark
node scripts/benchmark-runtime.js ../astrolabe-baseline
```

The optional path must be an installed checkout. The same script measures that checkout's runtime without altering it. It reports seven samples after warmup for heuristic classification, a 256-message text conversation, and stream setup. Run the two versions sequentially on an otherwise idle machine. Save stdout with the commit IDs and Node version in the PR or audit report.

Axios is stubbed for the benchmark, and the config contains only a dummy key. Results measure gateway CPU setup; they exclude HTTP, SSE transfer, model latency, and billable inference. Do not advertise them as production end-to-end latency or use noisy wall-clock thresholds as required CI gates. A real production latency claim needs comparable traffic, p50/p95, time to first token, provider time, retry counts, and cancellation counts.

## Production checks and access

The checked-in runtime is Astrolabe OSS. The public app at `https://app.astrolabe.run` and gateway at `https://api.astrolabe.run` run a separate Cloud deployment. Do not deploy OSS changes there without locating the Cloud source and deployment workflow.

```bash
npm run smoke:production -- https://api.astrolabe.run
```

This command checks health/readiness and verifies that documented inference/discovery routes reject unauthenticated requests. It sends only GETs and empty, unauthenticated POSTs, never a valid inference request. It fails on wrong statuses, invalid JSON, missing health markers, redirects, and timeouts. A 404 for a documented authenticated endpoint is reported as contract drift rather than success. Run explicitly against the intended origin; it is not part of offline tests or PR CI.

For browser QA, reuse an owned Aldo tab, check the landing page, model search, two-model comparison, pricing, docs navigation, and login. If a compact snapshot targets an element that fails actionability, take an upstream `aldo-browser engine TAB snapshot -i` and use its current refs or an unambiguous locator through the same engine. Close every owned tab after QA, including after errors.

Full Cloud verification additionally needs:

- The Cloud repository and the deployed revision mapped to a commit.
- A user-signed-in Browser panel session for dashboard QA, plus a dedicated test workspace for key/stack/billing flows.
- Read access to gateway logs and route traces, linked by request ID; redact prompts, keys, and account data in reports.
- An explicit budget before running billable inference tests, with short prompts and output limits.
- A browser harness operation for performance entries, console errors, network failures, and viewport sizes. Aldo currently rejects JavaScript evaluation, so this audit could not collect Web Vitals or execute browser-side measurements. HTTP asset sizes alone do not establish rendering speed.

Keep required catalog validation intact when providers retire IDs. Record exactly which IDs disappeared and review replacement identity, capabilities, pricing, and routing policy in a separate roster change. A healthy deployed gateway does not prove a fresh OSS checkout passes live catalog validation.

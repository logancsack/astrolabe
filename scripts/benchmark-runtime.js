const assert = require("node:assert/strict");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

// Optional checkout path lets the same workloads measure main and a worktree.
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const { createConfig } = require(path.join(root, "src/config"));
const { createRuntime } = require(path.join(root, "src/runtime"));
const axios = require(require.resolve("axios", { paths: [root] }));
const runtime = createRuntime(createConfig({ OPENROUTER_API_KEY: "benchmark-only" }));
const response = { setHeader() {} };
const messages = Array.from({ length: 256 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: "Review this implementation and explain the function. ".repeat(20)
}));
const body = { model: "astrolabe/coding", messages, stream: false };
let calls = 0;
const originalPost = axios.post;
axios.post = async () => {
  calls += 1;
  return {
    status: 200,
    data: { object: "chat.completion", choices: [{ message: { role: "assistant", content: '{"score":5,"reason":"ok"}' } }] }
  };
};

async function measure(name, iterations, run) {
  for (let i = 0; i < 500; i += 1) await run();
  const samples = [];
  for (let sample = 0; sample < 7; sample += 1) {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) await run();
    samples.push((performance.now() - start) * 1000 / iterations);
  }
  samples.sort((a, b) => a - b);
  return { name, iterations, median_us: +samples[3].toFixed(2), min_us: +samples[0].toFixed(2), max_us: +samples[6].toFixed(2) };
}

async function main() {
  try {
    const results = [];
    results.push(await measure("heuristic-coding", 10000, () => runtime.internals.heuristicClassification(
      "Debug this stack trace and refactor the function.", "user: fix the node test crash",
      { approxTokens: 220, messageCount: 3, hasMultimodal: false, hasToolsDeclared: false },
      { triggered: false, matchedSignals: [], actionLike: false }
    )));
    results.push(await measure("long-context-chat", 1000, async () => {
      const result = await runtime.executeChatRequest({ headers: {}, body }, response);
      assert.equal(result.object, "chat.completion");
      assert.ok(result.astrolabe?.candidate_models?.length);
    }));
    body.stream = true;
    results.push(await measure("long-context-stream-setup", 1000, () => runtime.executeChatRequest({ headers: {}, body }, response)));
    console.log(JSON.stringify({ node: process.version, root, upstream: "stubbed; no network or model latency", calls, results }, null, 2));
  } finally {
    axios.post = originalPost;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

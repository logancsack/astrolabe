const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { createConfig } = require("../src/config");
const { createAstrolabeApp } = require("../src/app");

async function openStream(t, api) {
  let upstreamResponse;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      upstreamResponse = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
    });
  });
  const servers = [upstream];
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    })));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const { app } = createAstrolabeApp(createConfig({
    OPENROUTER_API_KEY: "local-fixture-only",
    OPENROUTER_BASE_URL: `http://127.0.0.1:${upstream.address().port}`
  }));
  const gateway = app.listen(0, "127.0.0.1");
  servers.push(gateway);
  await once(gateway, "listening");
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/v1/${api}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "astrolabe/cheap", stream: true,
      ...(api === "responses" ? { input: "Hello" } : { messages: [{ role: "user", content: "Hello" }] })
    }),
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
  return { reader, controller, upstreamResponse };
}

for (const api of ["chat/completions", "responses"]) {
  test(`${api} forwards chunks before the upstream ends`, { timeout: 3000 }, async (t) => {
    const { reader, upstreamResponse } = await openStream(t, api);
    upstreamResponse.end("data: [DONE]\n\n");
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    assert.equal(rest, "data: [DONE]\n\n");
  });

  test(`${api} closes upstream when the client disconnects`, { timeout: 3000 }, async (t) => {
    const { controller, upstreamResponse } = await openStream(t, api);
    const closed = once(upstreamResponse, "close", { signal: AbortSignal.timeout(1000) });
    controller.abort();
    await closed;
    assert.equal(upstreamResponse.writableEnded, false);
  });

  test(`${api} terminates the client stream on upstream failure`, { timeout: 3000 }, async (t) => {
    const { reader, upstreamResponse } = await openStream(t, api);
    upstreamResponse.destroy();
    await assert.rejects(reader.read());
  });
}

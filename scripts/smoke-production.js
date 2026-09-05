// Public Cloud checks only: no credentials, valid inference payloads, or billable requests.
async function main() {
  if (!process.argv[2]) throw new Error("Usage: npm run smoke:production -- https://api.astrolabe.run");
  const origin = new URL(process.argv[2]);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error("Supply an HTTP(S) origin without a path, credentials, query, or fragment.");
  }
  const checks = [
    { path: "/health", status: 200 },
    { path: "/ready", status: 200 },
    { path: "/v1/models", status: 401 },
    { path: "/v1/lanes", status: 401 },
    { path: "/v1/responses", method: "POST", status: 401 },
    { path: "/v1/chat/completions", method: "POST", status: 401 }
  ];
  for (const check of checks) {
    const started = performance.now();
    try {
      const response = await fetch(new URL(check.path, origin), {
        method: check.method || "GET",
        ...(check.method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      const body = await response.json();
      const ok = response.status === check.status && (check.status === 200 ? body.ok === true : Boolean(body.error));
      console.log(JSON.stringify({
        path: check.path, status: response.status, expected: check.status, ok,
        ms: Math.round(performance.now() - started),
        ...(check.path === "/health" ? { revision: body.revision } : {}),
        errorCode: body.error?.code
      }));
      if (!ok) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ path: check.path, ok: false, error: error.message }));
      process.exitCode = 1;
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

const { RAW_MODEL_MANIFEST } = require("../src/manifests");

async function main() {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) {
    console.error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const payload = await response.json();
  const available = new Set(Array.isArray(payload?.data) ? payload.data.map((model) => model.id) : []);
  const missing = Object.entries(RAW_MODEL_MANIFEST)
    .filter(([, model]) => !available.has(model.id))
    .map(([key, model]) => ({ key, id: model.id }));
  if (missing.length) {
    console.error("Astrolabe manifest contains model IDs not found in the current OpenRouter catalog:");
    for (const entry of missing) {
      console.error(`- ${entry.key}: ${entry.id}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${Object.keys(RAW_MODEL_MANIFEST).length} static model IDs against OpenRouter.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

# Astrolabe Copilot Instructions

Follow the repo workflow in `AGENTS.md`.

Key rules:

- never commit directly to `main`
- use a short-lived branch and open a PR
- run `npm test`
- run `npm run validate:models`
- update docs when routing, manifests, env vars, or safety policy changes
- keep `m27` as the default serious-work model unless the task explicitly changes routing policy
- do not replace stable default lanes with preview models unless the task explicitly requires it

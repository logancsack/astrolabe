# Claude Code Instructions

Follow the repository workflow in [AGENTS.md](./AGENTS.md).

Minimum expectations:

1. Do not commit directly to `main`.
2. Create a branch for every change.
3. Run:
   - `npm test`
   - `npm run validate:models`
4. Open a PR to `main`.
5. Wait for CI before merge.

If you change routing, manifests, environment variables, or safety behavior, update the matching docs and tests in the same PR.

# Contributing to Astrolabe

Thanks for helping improve Astrolabe.

## Quick start

1. Fork the repo.
2. Create a branch from `main`: `git checkout -b feat/your-change`.
3. Make focused changes.
4. Test locally:
   - `npm install`
   - `npm test`
   - `npm run validate:models`
5. Open a pull request against `main` with:
   - problem statement
   - summary of changes
   - test evidence

## GitHub workflow

- `main` is the only long-lived branch.
- Do not push changes directly to `main`.
- Use short-lived branches such as `feat/...`, `fix/...`, `docs/...`, or `chore/...`.
- Open a pull request for every change, even small ones.
- Merge with **Squash and merge** so the `main` history stays clean and linear.
- After a release-worthy change lands on `main`, create a version tag like `v0.3.1` to publish a GitHub release.

## Guidelines

- Keep Astrolabe headless (no UI / no DB).
- Preserve OpenAI-compatible `POST /v1/chat/completions` behavior.
- Keep comments clear and practical.
- Prefer small, reviewable PRs.
- Update README if behavior or setup changes.
- If you change routing, safety policy, or the model roster, update docs and tests in the same PR.

## Reporting bugs

Open an issue with:

- expected behavior
- actual behavior
- sample request payload (without secrets)
- logs and environment details

## Security

Do not open public issues for sensitive vulnerabilities.
Use the process in `SECURITY.md`.

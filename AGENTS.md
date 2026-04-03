# Astrolabe Agent Instructions

This repository uses a PR-first workflow. If you are an AI coding agent working in this repo, follow these rules unless the user explicitly says otherwise.

## Branch and merge workflow

1. Never commit directly to `main`.
2. Create a short-lived branch from `main` for every change.
3. Use clear branch names such as:
   - `feat/...`
   - `fix/...`
   - `docs/...`
   - `chore/...`
4. Open a pull request back into `main`.
5. Wait for required checks to pass before merge.
6. Prefer **Squash and merge**.

## Required local validation

Run these before asking to merge:

```bash
npm test
npm run validate:models
```

If you changed routing, manifests, safety behavior, or docs, say so clearly in the PR summary.

## What to update together

- If you change routing behavior, update:
  - `src/runtime.js`
  - tests
  - routing docs
- If you change the model roster, update:
  - `src/manifests/index.js`
  - tests
  - model roster docs
- If you add or change environment variables, update:
  - `.env.example`
  - `README.md`
  - any relevant docs
- If you change security or tool policy, update:
  - tests
  - `README.md`
  - `SECURITY.md` if disclosure or policy changed

## GitHub checks and repo policy

`main` is protected.

Required checks:

- `test`
- `validate-model-manifest`

Repository policy:

- PRs are required for `main`
- conversation resolution is required
- linear history is required
- merged branches are auto-deleted

## Safety and operational rules

- Do not weaken safety or tool approval rules without explicit user approval.
- Do not remove validation or CI checks to make a PR pass.
- Do not silently swap stable models for preview models in default lanes.
- Treat `m27` as the main serious-work default unless the user asks for a routing change.
- Keep Astrolabe OSS stateless.

## Release process

Releases are tag-based.

When asked to cut a release:

1. Ensure `main` is up to date.
2. Create a tag like `v0.3.1`.
3. Push the tag.
4. GitHub Actions will create the GitHub release.

## Human-readable sources of truth

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/CODEOWNERS`
- `.github/workflows/ci.yml`

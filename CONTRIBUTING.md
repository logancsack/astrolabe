# Contributing to Astrolabe

Thanks for helping improve Astrolabe.

## Quick start

1. Fork the repo.
2. Create a branch: `git checkout -b feat/your-change`.
3. Make focused changes.
4. Test locally:
   - `npm install`
   - `node --check server.js`
5. Open a pull request with:
   - problem statement
   - summary of changes
   - test evidence

## Guidelines

- Keep Astrolabe headless (no UI / no DB).
- Preserve OpenAI-compatible `POST /v1/chat/completions` behavior.
- Keep comments clear and practical.
- Prefer small, reviewable PRs.
- Update README if behavior or setup changes.

## Reporting bugs

Open an issue with:

- expected behavior
- actual behavior
- sample request payload (without secrets)
- logs and environment details

## Security

Do not open public issues for sensitive vulnerabilities.
Use the process in `SECURITY.md`.
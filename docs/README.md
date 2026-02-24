# Astrolabe Docs (Mintlify)

This folder contains the Mintlify documentation site for Astrolabe.

## Documentation intent

The docs are written for two goals at the same time:

1. preserve technical precision (API contracts, routing behavior, env variable semantics)
2. explain system behavior clearly from first principles (what happens, why it happens, and how to verify it)

If you add or change features, keep both goals in the updated pages.

## Page structure expectation

User-facing pages should include:

- purpose and mental model
- lifecycle or architecture context
- concrete setup/config steps
- operational verification notes

## Local preview

Run from this folder:

```bash
npx mint dev
```

Then open `http://localhost:3000`.

## Deploy with Mintlify

1. Push this repo to GitHub.
2. In your Mintlify dashboard, connect the repo.
3. Ensure the docs root points to this `docs/` folder.
4. Push changes to your default branch to publish updates.

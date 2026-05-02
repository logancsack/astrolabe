# Astrolabe Cloud Docs

This folder contains the Mintlify documentation site for Astrolabe Cloud.

## Documentation intent

The docs should describe the hosted product first:

1. Cloud app setup, workspace keys, prepaid billing, and hosted gateway usage
2. Routing stacks, stack customization, stack assignment, and request-level stack selection
3. API contracts, response headers, route traces, and support-oriented debugging

If you add or change product behavior, update both the conceptual guide and the relevant API reference page.

## Page structure expectation

User-facing pages should include:

- purpose and mental model
- Cloud setup or request examples
- stack, billing, or trace behavior when relevant
- operational verification notes

## Preview

Run the Mintlify preview command from this folder using the Mintlify CLI available in your environment.

## Deploy with Mintlify

1. Push this repo to GitHub.
2. In the Mintlify dashboard, connect the repo.
3. Ensure the docs root points to this `docs/` folder.
4. Push changes to the publishing branch.

# Theme Factory v0.1 — isolated foundation
This module is intentionally **not imported** by the existing Money Scout worker.
No deployment, cron, binding, existing D1 schema, or root package scripts are changed.

## Scope
- Pure job validation, lifecycle transitions, retry limits, zero-cost budget guard.
- Separate SQL migration (NOT applied automatically).
- Node built-in test runner; no dependencies.

## Run tests
`node --test theme_factory/tests/*.test.mjs`

## Next step
Add a dedicated Theme Factory Worker binding/endpoint and D1 migration **after** review.
AI generation, file packaging, dashboard, sales integrations and publishing are **not yet implemented**.
Do not deploy or apply the migration against production without backup and approval.

# Theme Factory

AI-assisted mobile wallpaper and theme product factory.

## Status
v0.1 foundation: local job queue, retry/budget guard, automated tests, and a standalone Cloudflare Worker health endpoint.

This is **not** a completed image-generation or automatic storefront publishing product.

## Commands
```bash
npm run check
npm test
npm run theme -- create "Moon Dragon"
npm run theme -- list
```

## Cloudflare
The Wrangler configuration targets a **new** Worker named `automation-factory-theme-factory`. It has no Money Scout cron or D1 binding. Deployment is not performed automatically by this repository.

## Files
- `theme_factory/core.mjs`: job state rules
- `theme_factory/cli.mjs`: local CLI
- `theme_factory/worker.mjs`: isolated health API
- `theme_factory/schema.sql`: future database migration, not applied
- `theme_factory/tests/`: tests

Previous Money Scout code has been removed from the working tree; its historical commits remain available in Git.

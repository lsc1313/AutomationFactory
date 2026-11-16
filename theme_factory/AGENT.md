# Theme Factory autonomous agent v1

Purpose: continuously prepare coherent, original mobile-theme product **blueprints** at zero paid API cost. This is not an image generator or auto-publication system.

## How it works
- GitHub Actions `Theme Factory Autonomous Agent` runs every 6 hours or by manual dispatch.
- Queue, backoff and draft files live on a separate `theme-agent-state` branch. The main branch is not modified by the bot.
- First run seeds four original concepts; later runs deduplicate and resume queued work.
- Optional repository secret `GEMINI_API_KEY` generates marketing copy using Gemini. No key means deterministic fallback copy.
- API quota/429 or transient failure defers the job until exponential backoff has elapsed. It is **not** treated as a daily hard call cap. Auth errors block the affected job rather than endlessly retrying.
- Max jobs per run defaults to 3, a per-run throughput control, **not** an AI call quota.
- Output per theme: `generation-plan.json`, `product-draft.json`, `listing-draft.json`. All clearly mark images `not-generated`.
- The drafts are also available as Actions artifacts. These are not sellable image assets.

## Run locally
```bash
node theme_factory/agent.mjs seed
node theme_factory/agent.mjs enqueue "Winter starlight"
node theme_factory/agent.mjs run
node theme_factory/agent.mjs status
```

## Next production stage
Integrate a verified free image provider or local image worker via the existing `produceTheme` / `runGeneration` interface, then pass image QC, copyright checks, packaging, and an explicit publishing approval gate. Do not claim wallpaper images or store listings are finished before those steps. Image generators may have separate terms or fees.

## Security
No secrets stored in Git. State and prompt drafts only. Mainline deployment, Worker configuration and customer-facing storefront remain unchanged. Review PR before enabling scheduled workflow.

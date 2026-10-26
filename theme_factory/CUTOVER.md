# Existing Worker cutover checklist

The deployment target is the existing `automation-factory-money-scout` Cloudflare Worker. This change makes `theme_factory/worker.mjs` use the authenticated AI preview module, **but the preview is disabled by default**.

Before deploying, review the existing Worker and its bindings. The old Money Scout endpoints will disappear after deployment. No Cloudflare deployment occurs automatically from a GitHub merge.

To enable **one** authenticated AI preview per UTC day, independently configure the following on the existing Worker:
- Secret `CLOUDFLARE_AI_TOKEN` (already reported registered by user)
- Secret `ADMIN_TOKEN` (a new random value, never commit to GitHub)
- Text variable `CLOUDFLARE_ACCOUNT_ID` (Cloudflare account ID)
- D1 binding `THEME_QUOTA_DB` pointing to a **dedicated Theme Factory database** initialized with `preview_quota.sql`
- Text variable `THEME_AI_PREVIEW_ENABLED=1` only after confirming Cloudflare AI billing/quota

Keep the enable flag unset during initial deployment. `/health` should return `app: Theme Factory` and `productionReady:false`. No real image generation is attempted by a health check.

**Caution:** D1 bindings need to be reflected in Wrangler config for repeatable deployments. This branch does not invent a D1 database ID or modify an unrelated database. There is no cost guarantee, global rate limit, image storage, or sales automation yet.

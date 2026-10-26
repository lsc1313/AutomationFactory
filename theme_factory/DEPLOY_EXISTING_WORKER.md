# Replacing the old Money Scout Worker

The GitHub repository has already migrated to Theme Factory. Cloudflare still runs the old `automation-factory-money-scout` deployment until an explicit deployment is performed.

`wrangler.jsonc` deliberately targets the existing `automation-factory-money-scout` service. This **replaces its live code** with `theme_factory/worker.mjs`, which currently serves only GET `/` and `/health` and returns `productionReady:false`. It does **not** deploy a full Theme Factory image generation API yet.

**Deployment is intentionally manual:** no GitHub Actions workflow deploys automatically. From the repository root, after authenticating Wrangler to the intended Cloudflare account, run `npm install`, `npm run check`, then `npm run deploy:theme`. This is a destructive replacement of the old Money Scout code; confirm before executing. A successful deployment should show `app:Theme Factory` on `/health`. Do not assume the deployment happened from a GitHub merge.

Existing Cloudflare secrets and databases are not explicitly deleted by this repository change. However, Wrangler configuration and bindings should be reviewed before deployment; omitted bindings may become unavailable to the new Worker. The newly registered `CLOUDFLARE_AI_TOKEN` is **not read by the current Worker** and does not enable generation yet.

GuildCore and ShortsAI repositories and Workers are not targeted.

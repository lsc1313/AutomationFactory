# Cloudflare AI preview API (not deployed)

`theme_factory/worker_preview.mjs` is an **opt-in experimental worker**. It is not the `wrangler.jsonc` entrypoint yet and is not deployed.

POST `/api/preview-image` requires:
- `ADMIN_TOKEN` secret and matching `Authorization: Bearer ...`
- `CLOUDFLARE_AI_TOKEN` secret
- `CLOUDFLARE_ACCOUNT_ID` environment variable
- `THEME_AI_PREVIEW_ENABLED=1` (default disabled)

It requests one 1024x1024 image from Cloudflare Workers AI. Cloudflare account quota and billing limits **must be checked before enabling it**. Do not enable this endpoint on an open public site without rate limits and budget controls. A caller could otherwise repeatedly generate billable images. Current code does not provide server-side rate limiting or a daily spend cap.

**Known gap:** the existing `CLOUDFLARE_AI_TOKEN` is present on the old Money Scout worker, but account ID and preview enable flag have not been configured. This feature has only mock/no-network tests; it is not evidence of successful inference. The preview is not yet connected to ZIP packaging.

# Daily quota for preview inference

The preview Worker now requires `THEME_QUOTA_DB`, a dedicated Cloudflare D1 binding. Run `theme_factory/preview_quota.sql` against a **new Theme Factory D1 database** before enabling preview. It atomically reserves one attempt per UTC day, before making any AI request. Failed calls still consume the day's reservation to prevent retries from unexpectedly increasing charges.

This quota limits **calls**, not actual cost. Cloudflare may charge for inference depending on account billing and model. Keep `THEME_AI_PREVIEW_ENABLED` disabled until Cloudflare billing and model response behavior are verified. Never bind an unrelated GuildCore or Money Scout D1 database.

The current production entrypoint remains `theme_factory/worker.mjs`, not `worker_preview.mjs`; the quota feature is not deployed or enabled.

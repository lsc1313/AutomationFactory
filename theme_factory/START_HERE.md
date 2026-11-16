# Theme Factory — autonomous production agent

**Status:** generation-to-ZIP pipeline implemented on this branch. Use the smoke-test workflow to verify the actual runtime. Publication to commercial marketplaces is **not** connected.

## End-to-end pipeline

1. Seed or enqueue original concepts.
2. Generate a text description with Gemini when a key is configured; automatically fall back to template copy if unavailable.
3. Create wallpapers (3), lock screen (1), and coordinated icons (10).
4. Validate image formats and expected dimensions, normalize every image to target resolution.
5. Produce a ZIP with assets, product.json and unpublished listing.json.
6. Upload ZIP as GitHub Actions artifact for inspection. **No automatic sales listing or account access.**

## First test without installing anything on your PC

1. Merge the PR into main **after smoke-test checks pass**.
2. Open repository **Actions** > **Theme Factory Autonomous Agent** > **Run workflow**.
3. Set `image_provider = procedural` and optionally type a concept, then Run.
4. Open finished workflow run > **Artifacts** > **theme-factory-products** to download ZIPs.
5. The schedule runs every 6 hours in procedural mode and prepares up to one packaged theme per run. Drafts are queued and resumed from `theme-agent-state`.

**Note:** Procedural mode is algorithmic vector-based artwork. It requires no image-generation AI key and is suitable for plumbing tests and prototype assets, **not a substitute for high-quality AI artwork**.

## AI image generation (optional, metered)

GitHub repo > Settings > Secrets and variables > Actions:
- **Secret** `GEMINI_API_KEY` (Gemini text and image provider), or
- **Secrets** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` (Cloudflare Workers AI model).
- **Variable** `THEME_ALLOW_METERED` = `1` to explicitly enable paid/metered services.
- Run workflow manually with `image_provider = gemini` or `cloudflare`.

Even with available free credits or a free tier, API billing is provider-dependent; there is **no guarantee of zero cost**. This system does not charge or purchase credits itself. Automatic scheduled runs always default to `procedural` to avoid accidental costs. Image model availability can change; the Cloudflare SDXL Lightning model is marked for deprecation 2026-11-20, so prefer an available provider and validate model availability before use.

The image generation call is normalized with Sharp, QC checked, and ZIP packaged. Gemini's model is configured by `THEME_IMAGE_MODEL` locally and defaults to `gemini-2.5-flash-image`; change it if your account supports another image-capable model.

## Local execution

```sh
npm install --no-save sharp
node theme_factory/agent.mjs enqueue "Twilight cherry blossom temple"
node theme_factory/agent.mjs run
node theme_factory/fulfill.mjs
node theme_factory/agent.mjs status
```

The ZIP files are under `theme_factory/agent-data/products`. Set `THEME_IMAGE_PROVIDER` to `gemini` or `cloudflare` and `THEME_ALLOW_METERED=1` to run corresponding APIs after configuring environment variables. Set `THEME_AGENT_DIR` to change output location.

## Recovery and safety

- A quota/429 or temporary failure is deferred exponentially, not permanently stopped. Credential and unsupported-provider errors are blocked with error messages.
- Text AI failure never halts a production job: template copy is used.
- The agent's persistent queue is saved on an isolated Git branch. Product ZIPs are **not** committed to Git; downloadable action artifacts expire in 14 days.
- No publish to stores, charge, external webhook, or Cloudflare production deployment is performed.
- Artifacts must be visually reviewed, verified for rights/licensing and formatted for each store before sale. Different mobile platforms have distinct theme formats: a ZIP wallpaper pack is not automatically a Galaxy Themes or Android launcher theme package.

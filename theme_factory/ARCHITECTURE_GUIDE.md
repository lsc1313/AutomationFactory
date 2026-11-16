# Architecture-driven Theme Factory

The user supplies **one architecture JSON**. The agent builds exactly the specified assets, validates dimensions and packages the theme into **one downloadable ZIP**. No storefront or blog account is required.

## Workflow

1. Copy `theme_factory/architectures/moonlit-jade-garden.json` to a new file in `theme_factory/architectures/`.
2. Edit `slug`, `name`, `concept`, `style`, `palette`, and `assets` (each asset's `id`, `type`, `width`, `height`, `prompt`).
3. Go to GitHub **Actions > Theme Factory architecture build > Run workflow**, enter the JSON path and choose image provider.
4. Download **architecture-theme-zip** from the finished run's Artifacts. Open the nested ZIP for your actual PNG assets and manifest.

## Required schema

```json
{
  "schemaVersion": 1,
  "slug": "my-theme",
  "name": "My Theme",
  "concept": "Shared visual identity",
  "style": "Cohesive illustration direction",
  "palette": ["#112233", "#aabbcc", "#ffffff"],
  "quality": {"minUniqueAssets": 2},
  "license": "personal-use",
  "assets": [
    {"id": "wallpaper-01", "type": "wallpaper", "width": 1440, "height": 3200, "prompt": "An original primary scene"},
    {"id": "icon-phone", "type": "icon", "width": 1024, "height": 1024, "prompt": "Recognizable phone handset silhouette"}
  ]
}
```

The number of assets, their exact IDs, types, prompts, pixel dimensions, and palette are driven by the architecture, **not hardcoded to 14 assets**. Types: wallpaper, lockscreen, icon, banner, preview, other. Limit: 60 images, 128–6000px width, 128–8000px height. There must be at least one wallpaper. Duplicate IDs and unsafe filenames are rejected.

## Image engine choice

- **procedural** (default): no API key; renders deterministic vector-inspired PNG art and proves that your architecture produces a valid package. **It does not produce photorealistic AI illustration**, and its icon symbolism is limited. Architecture palette and prompt subject guide the output.
- **gemini**: requires repository secret `GEMINI_API_KEY`, and repository variable `THEME_ALLOW_METERED=1`. Requests one image per asset to a supported image model. Fees/quotas depend on the API account and model. A text-only Gemini key or insufficient quota cannot generate images.
- **cloudflare**: requires secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` plus `THEME_ALLOW_METERED=1`. Availability of the currently configured image model should be verified.

**No silent substitution:** If a chosen image API is unavailable, the run fails rather than replacing artwork with procedural illustrations and pretending it passed. The ZIP isn't uploaded unless every requested image passes file/dimension/uniqueness QC.

## Local execution

```sh
npm install --no-save sharp
node theme_factory/build_architecture.mjs theme_factory/architectures/moonlit-jade-garden.json ./theme-output
```

Set `THEME_IMAGE_PROVIDER=gemini` or `cloudflare` when you have appropriate credentials and explicitly opt in to metered APIs.

## Output layout

```text
my-theme.zip
  assets/<your-asset-ids>.png
  architecture.json
  manifest.json
  README.txt
```

`manifest.json` records asset roles, dimensions and SHA-256 checksums. Work-in-progress checkpoint data lives next to the theme output. A retry reuses matching previously generated PNG assets. The workflow's temporary runner does not persist local checkpoints across independent GitHub Actions runs.

For sale or blog distribution, visually review the produced images, rights and any platform-specific requirements. Image dimensions, checksums and uniqueness do not guarantee professional aesthetic quality.

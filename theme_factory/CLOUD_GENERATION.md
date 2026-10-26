# Cloudflare Workers AI cloud generation prototype

Cloudflare Workers AI supports image models including `@cf/bytedance/stable-diffusion-xl-lightning`. The REST adapter `cloudflare_provider.mjs` accepts an account ID and scoped Workers AI token. **No credentials are stored in this repository and no real inference call has been made.**

Cloudflare documents a daily free allocation, but **free allocation is not a zero-billing guarantee** for a paid account. Monitor usage and configure billing restrictions before enabling automatic calls. The `costCents:0` property represents this adapter's fee, not the actual provider cost.

**Known integration gap:** the model supports maximum height 2048, whereas the current product plan targets 1440x3200; this prototype caps requests at 1024x2048, so `produceTheme` will correctly reject the result as a size mismatch. The image model may return JPEG bytes even if the manifest currently expects PNG. A resizing/transcoding stage and explicit cost control are required before end-to-end use. Do not deploy as an automatic production pipeline yet.

Official documentation: https://developers.cloudflare.com/workers-ai/platform/pricing/ and https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-lightning/

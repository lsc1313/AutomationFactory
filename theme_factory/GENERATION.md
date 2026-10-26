# Generation pipeline v0.5 (provider-neutral)

`makeGenerationPlan` creates consistent prompts and fixed target sizes for wallpapers, lock screens and icons. `runGeneration` runs a supplied provider adapter with at most three attempts per asset.

**Important:** This milestone implements the orchestration interface only. No actual image-generation provider is connected, and no images are created by the repository without a provider implementation. Zero-cost mode refuses adapters that declare a nonzero per-call cost; actual billing must also be checked at the provider level. Generation outputs are not yet saved or passed into the ZIP builder.

Next: connect a verified free/local provider adapter, write generated assets, validate decoded image dimensions, and package only accepted results.

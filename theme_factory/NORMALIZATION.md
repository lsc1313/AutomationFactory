# Optional image normalization

`produceTheme(product, provider, outputRoot, {normalize:true})` can now normalize provider output to exact target dimensions and PNG using Sharp. Sharp is **not** bundled and must be installed explicitly with `npm install sharp` in the environment that runs packaging. The default remains `normalize:false`, preserving previous behavior.

The conversion crops to cover the target aspect ratio, so artwork may lose edge content; a composition-aware review is still needed. Sharp does not generate or enhance missing visual detail. The cloud provider is **not** connected to an automatic deployment, and no real image-generation request has been tested. Cloudflare billing and usage controls remain a prerequisite.

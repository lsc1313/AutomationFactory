# Theme Factory product manifest v0.2

A product starts with a JSON manifest. No image-generation API or storefront account is required to validate it.

Example:

```json
{
  "slug": "moon-dragon",
  "title": "Moon Dragon",
  "description": "Dark fantasy mobile wallpapers",
  "wallpapers": [{"file": "assets/wallpaper-01.png", "width": 1440, "height": 3200}],
  "icons": []
}
```

Only paths under `assets/` with PNG/JPG/WebP names are allowed. Product metadata and listing drafts can be validated with `validateProduct` and `storefrontListing` in `product.mjs`.

This step **does not** generate image files, inspect image bytes, create ZIPs, or publish listings. Those are future steps.

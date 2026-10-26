# Local generation preflight

Before downloading a model or running inference, inspect the actual PC:

```powershell
python theme_factory/adapters/preflight.py
```

To check an already downloaded model directory, set `THEME_MODEL_PATH` in the same shell first.

The report includes installed Python packages, CUDA availability, GPU model and VRAM (if accessible), free disk space and whether a local model directory exists. **No image is generated, no packages are installed and no model is downloaded.**

`ready: true` is only a preliminary signal, not a guarantee that a model will run or fit in VRAM. This tool does not check model compatibility, licenses, system RAM or image quality. For CPU-only machines, consider a hosted provider or lower-resolution workflow rather than assuming local high-resolution diffusion will work.

# Optional local AI image generator (v0.8)

This is a **real inference adapter**, not a bundled model. It uses Python Diffusers to load a separately downloaded local Stable Diffusion-compatible model and return PNG image bytes to Theme Factory. The repository does not download model weights or include a GPU. End-to-end generation has **not been verified** on the user's PC.

## Requirements

- Python, PyTorch, Diffusers, Transformers, Accelerate and Pillow, installed independently.
- A Diffusers-format local model directory, with a license allowing intended commercial use.
- Adequate RAM/VRAM and disk space. The current default 1440x3200 outputs are large and can cause out-of-memory errors, especially on older PCs or CPU-only setups. CPU-only inference may be impractically slow.
- No paid API is used by this adapter; hardware and electricity are not free.

## Example

```powershell
python -m pip install torch diffusers transformers accelerate pillow
node theme_factory/generate_local.mjs moon "silver moon and dragon" "D:\\models\\my-diffusers-model" ./theme-output
```

Use `THEME_PYTHON` to override the Python executable. The model must already exist at `THEME_MODEL_PATH` (set by the CLI). Generated images are inspected and packaged by the existing production pipeline.

**Limitations:** No integrated model installation, licensing verification, GPU capability probe, automatic image resizing/upscaling, style scoring, or actual model inference test in CI. Do not use this on an untrusted model directory. Real image generation may fail due to memory limits or model incompatibility.

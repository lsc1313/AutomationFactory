"""Optional local Stable Diffusion adapter for Theme Factory.
Requires separately installed torch, diffusers, transformers, accelerate, Pillow
and a locally available model. Writes PNG bytes to stdout only.
"""
import io
import os
import sys

def main():
    try:
        import torch
        from diffusers import StableDiffusionPipeline
    except ImportError as exc:
        raise RuntimeError("Install torch, diffusers, transformers, accelerate and Pillow first") from exc
    model = os.environ.get("THEME_MODEL_PATH")
    if not model or not os.path.isdir(model):
        raise RuntimeError("THEME_MODEL_PATH must point to a local Diffusers model directory")
    width = int(os.environ["THEME_WIDTH"])
    height = int(os.environ["THEME_HEIGHT"])
    if width < 64 or height < 64 or width % 8 or height % 8 or width * height > 4_608_000:
        raise RuntimeError("Invalid image size")
    prompt = os.environ["THEME_PROMPT"]
    if not prompt.strip():
        raise RuntimeError("Empty prompt")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = StableDiffusionPipeline.from_pretrained(model, torch_dtype=dtype, local_files_only=True)
    pipe = pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    with torch.inference_mode():
        image = pipe(prompt, width=width, height=height, num_inference_steps=20).images[0]
    out = io.BytesIO()
    image.save(out, format="PNG")
    sys.stdout.buffer.write(out.getvalue())
    sys.stdout.buffer.flush()

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Local generation failed: " + str(exc), file=sys.stderr)
        sys.exit(1)

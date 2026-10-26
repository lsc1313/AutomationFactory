# Windows PC diagnostic (one click)

Download or clone the repository on the PC and double-click `theme_factory/check_pc.bat`. The script uses the Python launcher (`py -3`) when available, otherwise `python`. It does not install anything or generate images. Results are printed and saved in `theme_factory/.local/pc-diagnostics.json` (ignored by Git).

If Python is missing, the script explains that and exits. Send the **non-sensitive** report fields (GPU, VRAM, CUDA, dependencies, disk) to evaluate whether local generation is realistic. Review the file before sharing; the platform field can contain machine information.

Do not assume that passing the diagnostic means image inference is validated. No GPU or CPU-only inference is likely to be slow at 1440x3200.

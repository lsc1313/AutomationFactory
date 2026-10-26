"""Read-only hardware and dependency preflight for optional local generation."""
import importlib.util
import json
import os
import platform
import shutil
import sys

def check():
    modules = {name: importlib.util.find_spec(name) is not None for name in ("torch", "diffusers", "transformers", "accelerate", "PIL")}
    result = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "dependencies": modules,
        "modelPathConfigured": bool(os.environ.get("THEME_MODEL_PATH")),
        "modelPathExists": os.path.isdir(os.environ.get("THEME_MODEL_PATH", "")),
        "freeDiskGB": round(shutil.disk_usage(os.getcwd()).free / (1024 ** 3), 2),
        "cudaAvailable": None,
        "gpuName": None,
        "gpuMemoryGB": None,
        "ready": False,
        "warnings": [],
    }
    if modules["torch"]:
        try:
            import torch
            result["cudaAvailable"] = bool(torch.cuda.is_available())
            if result["cudaAvailable"]:
                props = torch.cuda.get_device_properties(0)
                result["gpuName"] = props.name
                result["gpuMemoryGB"] = round(props.total_memory / (1024 ** 3), 2)
        except Exception as exc:
            result["warnings"].append("torch inspection failed: " + str(exc))
    if not all(modules.values()):
        result["warnings"].append("Missing Python dependencies")
    if not result["modelPathExists"]:
        result["warnings"].append("Local Diffusers model path not configured or missing")
    if result["cudaAvailable"] is False:
        result["warnings"].append("CUDA unavailable; CPU generation may be too slow")
    if result["gpuMemoryGB"] is not None and result["gpuMemoryGB"] < 8:
        result["warnings"].append("Less than 8 GB GPU memory; 1440x3200 generation may fail")
    if result["freeDiskGB"] < 10:
        result["warnings"].append("Less than 10 GB free disk space")
    result["ready"] = all(modules.values()) and result["modelPathExists"] and result["cudaAvailable"] is True and result["freeDiskGB"] >= 10
    return result

if __name__ == "__main__":
    print(json.dumps(check(),ensure_ascii=False,indent=2))

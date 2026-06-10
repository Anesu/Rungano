"""
SystemInfo — GPU query and WSL path translation.

Stateless module-level functions. No class needed — callers just import and call.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess

logger = logging.getLogger("higgs.system")


def gpu_info() -> dict:
    """Query nvidia-smi for GPU name and VRAM stats. Returns empty dict on failure."""
    gpu = {"name": "", "vram_used_mb": 0, "vram_total_mb": 0, "vram_free_mb": 0}
    try:
        nvsmi = os.path.join(
            os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe"
        )
        out = subprocess.check_output(
            [nvsmi, "--query-gpu=name,memory.used,memory.total,memory.free",
             "--format=csv,noheader,nounits"],
            timeout=5,
            text=True,
        ).strip()
        parts = out.split(",")
        if len(parts) >= 4:
            gpu["name"] = parts[0].strip()
            gpu["vram_used_mb"] = int(parts[1].strip())
            gpu["vram_total_mb"] = int(parts[2].strip())
            gpu["vram_free_mb"] = int(parts[3].strip())
    except Exception:
        pass
    return gpu


def wsl_path(windows_path: str) -> str:
    """Convert C:\\... → /mnt/c/... for WSL2 interop."""
    p = windows_path.replace("\\", "/")
    m = re.match(r"^([A-Za-z]):/", p)
    if m:
        p = f"/mnt/{m.group(1).lower()}/{p[3:]}"
    return p

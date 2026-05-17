"""
CLI validation: solver → forward_raytrace → SSIM / RMS / energy report.

Usage (run from project root with backend venv active):
    python -m backend.validate <project_id>

The tool loads a saved project, obtains a height field (running the solver
if none is stored), then forward-raytraces it and compares the result to
the original target image.
"""

from __future__ import annotations

import os
import sys
import base64
import io

import numpy as np
from PIL import Image


def _add_backend_to_path() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)


def _decode_target(b64: str, resolution: int) -> np.ndarray:
    data = base64.b64decode(b64)
    img = Image.open(io.BytesIO(data)).convert("L")
    img = img.resize((resolution, resolution), Image.LANCZOS)
    return np.array(img, dtype=np.float64) / 255.0


def _ssim(a: np.ndarray, b: np.ndarray) -> float:
    try:
        from skimage.metrics import structural_similarity
        return float(structural_similarity(a, b, data_range=1.0))
    except ImportError:
        # Simple global SSIM approximation if scikit-image is unavailable
        mu_a, mu_b = float(a.mean()), float(b.mean())
        sig_a = float(a.std())
        sig_b = float(b.std())
        sig_ab = float(np.mean((a - mu_a) * (b - mu_b)))
        C1, C2 = 0.01 ** 2, 0.03 ** 2
        return (2 * mu_a * mu_b + C1) * (2 * sig_ab + C2) / (
            (mu_a ** 2 + mu_b ** 2 + C1) * (sig_a ** 2 + sig_b ** 2 + C2)
        )


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) < 1:
        print("Usage: python -m backend.validate <project_id>", file=sys.stderr)
        return 1

    project_id = argv[0]
    _add_backend_to_path()

    import projects as P
    import solver as S
    from forward_raytrace import forward_raytrace

    try:
        proj = P.load_project(project_id)
    except FileNotFoundError:
        print(f"Project not found: {project_id}", file=sys.stderr)
        return 1

    params = proj.get("params", {})
    target_b64: str = proj["target_image"]
    resolution = int(params.get("resolution", 128))
    n_refract = float(params.get("n", 1.49))
    proj_dist = float(params.get("proj_dist", 0.5))
    phys_x = float(params.get("physical_size_x", 0.05))
    phys_y = float(params.get("physical_size_y", 0.05))
    thickness = float(params.get("thickness", 0.003))
    smoothing = float(params.get("smoothing", 1.0))
    magnification = float(params.get("magnification", 1.0))
    scd = int(params.get("smoothing_cooldown_iterations", 100))

    # Use mean of physical sizes as square approximation for lens_size_m
    lens_size_m = (phys_x + phys_y) / 2.0

    if "height_field" in proj:
        h = np.array(proj["height_field"], dtype=np.float64)
        print(f"Loaded stored height field ({h.shape[0]}x{h.shape[1]})")
    else:
        print("No height field stored — running solver...")
        result = S.run_solver(
            image_b64=target_b64,
            n_refract=n_refract,
            thickness=thickness,
            proj_dist=proj_dist,
            smoothing=smoothing,
            resolution=resolution,
            physical_size_x=phys_x,
            physical_size_y=phys_y,
            magnification=magnification,
            smoothing_cooldown_iterations=scd,
        )
        h = result.height_field
        print(
            f"  converged={result.converged}  "
            f"iters={result.iterations_used}  "
            f"rms={result.final_rms_error:.3e}"
        )

    target = _decode_target(target_b64, resolution)

    print(f"Forward ray-tracing  n_rays=1_000_000  res={resolution}x{resolution} ...")
    sim, energy_ratio = forward_raytrace(
        h=h,
        lens_size_m=lens_size_m,
        projection_distance_m=proj_dist,
        refractive_index=n_refract,
        target_resolution=resolution,
        n_rays=1_000_000,
    )

    # Normalize both arrays to [0, 1] using peak value for SSIM / RMS comparison
    sim_max = sim.max()
    tgt_max = target.max()
    sim_n = np.clip(sim / max(sim_max, 1e-12), 0.0, 1.0)
    tgt_n = np.clip(target / max(tgt_max, 1e-12), 0.0, 1.0)

    rms = float(np.sqrt(np.mean((sim_n - tgt_n) ** 2)))
    ssim_val = _ssim(sim_n, tgt_n)

    print()
    print("=" * 52)
    print(f"  Energy conservation ratio : {energy_ratio:.4f}")
    print(f"  RMS error (peak-norm)     : {rms:.4f}")
    print(f"  SSIM (peak-norm)          : {ssim_val:.4f}")
    print("=" * 52)
    return 0


if __name__ == "__main__":
    sys.exit(main())

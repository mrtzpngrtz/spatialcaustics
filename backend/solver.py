"""
Monge-Ampère iterative solver for inverse caustic height field computation.

Reference: Schwartzburg et al. 2014 — "High-contrast Computational Caustic Design"

Solver: iterative Poisson updates on intensity error, using DCT-based exact
        Poisson solver (O(N log N)) instead of sparse LU.

GPU path: CuPy (cupyx.scipy.fft.dctn + cupyx.scipy.ndimage).
          Falls back to scipy/numpy if CuPy is unavailable.

Physical unit conventions (IMPORTANT):
  - Height field h in meters, UV domain [0,1]²
  - Physical lens size S = 0.05 m (5 cm) — must match stl_export.py
  - Correct alpha: L*(n-1)/S²  [units: 1/m]
  - Jacobian: J = 1 + alpha * Δh_UV,  Δh_UV in [m] (UV dimensionless)
"""

from __future__ import annotations

import logging
import base64
import io
import os
import site as _site_mod

import numpy as np
from numpy.typing import NDArray
import scipy.ndimage as cpu_ndimage
import scipy.fft as cpu_fft
from PIL import Image

logger = logging.getLogger(__name__)

# ── Prepend all nvidia pip-wheel bin dirs to PATH so CuPy can find CUDA DLLs ──
def _add_nvidia_paths() -> None:
    for _p in _site_mod.getsitepackages():
        _nvidia = os.path.join(_p, "nvidia")
        if not os.path.isdir(_nvidia):
            continue
        for _pkg in os.listdir(_nvidia):
            _bin = os.path.join(_nvidia, _pkg, "bin")
            if os.path.isdir(_bin):
                _cur = os.environ.get("PATH", "")
                if _bin.lower() not in _cur.lower():
                    os.environ["PATH"] = _bin + os.pathsep + _cur
        # Point CUDA_PATH at nvrtc package (CuPy root detection)
        _nvrtc = os.path.join(_nvidia, "cuda_nvrtc")
        if os.path.isdir(_nvrtc):
            os.environ.setdefault("CUDA_PATH", _nvrtc)

_add_nvidia_paths()

# ── GPU detection ──────────────────────────────────────────────────────────────
try:
    import cupy as _cp                           # type: ignore[import-untyped]
    import cupyx.scipy.ndimage as _cp_ndimage    # type: ignore[import-untyped]
    import cupyx.scipy.fft as _cp_fft            # type: ignore[import-untyped]

    # Smoke-test: allocate array + DCT (avoids curand which we don't need)
    _test_arr = _cp.zeros((4, 4), dtype=_cp.float64)
    _test = _cp_fft.dctn(_test_arr, type=2)
    del _test_arr, _test

    _USE_GPU = True
    _DEVICE_NAME: str = str(_cp.cuda.Device(0))
    logger.info("CuPy GPU solver active — %s", _DEVICE_NAME)

except Exception as _gpu_err:
    _cp = None               # type: ignore[assignment]
    _cp_ndimage = None       # type: ignore[assignment]
    _cp_fft = None           # type: ignore[assignment]
    _USE_GPU = False
    logger.info("CuPy unavailable (%s) — using CPU solver", _gpu_err)


# ── Array-module helpers ───────────────────────────────────────────────────────

def _xp():
    """Return cupy or numpy depending on GPU availability."""
    return _cp if _USE_GPU else np


def _to_device(arr: NDArray[np.float64]):  # type: ignore[return]
    """Move numpy array to GPU (noop on CPU path)."""
    if _USE_GPU:
        return _cp.array(arr)
    return arr


def _to_cpu(arr) -> NDArray[np.float64]:  # type: ignore[return]
    """Move array back to numpy (noop on CPU path)."""
    if _USE_GPU:
        return _cp.asnumpy(arr)
    return arr


# ── Image loading ──────────────────────────────────────────────────────────────

def load_target_image(image_b64: str, resolution: int) -> NDArray[np.float64]:
    """
    Decode base64 image → grayscale → resize to (resolution, resolution).
    Returns float64 array in [0, 1] on CPU (transferred to device later).
    """
    raw = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(raw)).convert("L")
    img = img.resize((resolution, resolution), Image.LANCZOS)
    return np.array(img, dtype=np.float64) / 255.0


def normalize_intensity(I, xp):  # type: ignore[return]
    """
    Scale so that mean == 1 (energy conservation: uniform input maps to unit mean).
    Works with both numpy and cupy arrays.
    """
    s = I.sum()
    if float(s) < 1e-12:
        raise ValueError("Target image is effectively black — no energy to redistribute.")
    return I * (float(I.size) / float(s))


# ── DCT-based Poisson solver ───────────────────────────────────────────────────

def _build_aniso_eigenvalues(ny: int, nx: int, dx: float, alpha_x: float, alpha_y: float, xp):
    """
    Precompute eigenvalue matrix for the anisotropic operator
      alpha_x * d²/du² + alpha_y * d²/dv²
    in DCT-II basis. Entry [0,0] is set to 1 by caller to avoid ÷0.
    """
    kx = xp.arange(nx, dtype=xp.float64)
    ky = xp.arange(ny, dtype=xp.float64)
    lam_x = 2.0 * (xp.cos(xp.pi * kx / nx) - 1.0) / (dx * dx)
    lam_y = 2.0 * (xp.cos(xp.pi * ky / ny) - 1.0) / (dx * dx)
    return alpha_x * lam_x[None, :] + alpha_y * lam_y[:, None]


def solve_poisson_dct(rhs, dx: float, LAM_inv, fft_mod, xp):
    """Solve Δu = rhs (isotropic, legacy). LAM_inv eigenvalues of UV Laplacian."""
    b = rhs * (dx * dx)
    b = b - b.mean()
    B = fft_mod.dctn(b, type=2)
    U = B * LAM_inv
    u = fft_mod.idctn(U, type=2)
    return u - u.mean()


def solve_poisson_aniso(rhs, LAM_inv, fft_mod, xp):
    """
    Solve (alpha_x*d²/du² + alpha_y*d²/dv²) u = rhs  (Neumann BC).
    LAM_inv: precomputed 1/(alpha_x*lam_x + alpha_y*lam_y), [0,0]=0.
    No dx² scaling — alpha already carries physical units.
    """
    b = rhs - rhs.mean()
    B = fft_mod.dctn(b, type=2)
    U = B * LAM_inv
    u = fft_mod.idctn(U, type=2)
    return u - u.mean()


# ── Laplacian + Jacobian ───────────────────────────────────────────────────────

def compute_second_derivs(h, dx: float, xp):
    """
    Return (h_uu, h_vv): second derivatives along u (cols) and v (rows),
    via 3-point central differences with Neumann BC.
    """
    dx2 = dx * dx
    h_uu = (xp.roll(h, -1, axis=1) + xp.roll(h, 1, axis=1) - 2.0 * h) / dx2
    h_vv = (xp.roll(h, -1, axis=0) + xp.roll(h, 1, axis=0) - 2.0 * h) / dx2
    for arr in (h_uu, h_vv):
        arr[:,  0] = arr[:,  1]
        arr[:, -1] = arr[:, -2]
        arr[ 0, :] = arr[ 1, :]
        arr[-1, :] = arr[-2, :]
    return h_uu, h_vv


# ── Main solver ────────────────────────────────────────────────────────────────

def run_solver(
    image_b64: str,
    n_refract: float,
    thickness: float,
    proj_dist: float,
    smoothing: float,
    resolution: int,
    physical_size_x: float = 0.05,
    physical_size_y: float = 0.05,
    max_iterations: int = 200,
    convergence_tol: float = 5e-4,
    step_size: float = 0.3,
) -> NDArray[np.float64]:
    """
    Inverse caustic solver.

    Physics (UV-space formulation):
      Transport map: Φ(x) = x + L*(n-1)*∇h / S²
      Jacobian:      J = 1 + alpha * Δh,    alpha = L*(n-1)/S²  [1/m]
      Energy:        I_caustic = 1 / J
      Poisson step:  Δ(δh) = -(I_target - I_caustic) / alpha
      Update:        h ← h + step_size * δh

    Args:
        image_b64:       Base64-encoded target image.
        n_refract:       Refractive index (e.g. 1.49 for PETG).
        thickness:       Max lens height in meters (used only for output scaling).
        proj_dist:       Projection distance in meters.
        smoothing:       Gaussian regularization sigma in pixels.
        resolution:      Solver grid resolution (pixels per side).
        physical_size_x: Lens width in meters (default 5 cm).
        physical_size_y: Lens height in meters (default 5 cm).
        max_iterations:  Max gradient-descent iterations.
        convergence_tol: Stop when RMS error < tol.
        step_size:       Gradient-descent step multiplier.

    Returns:
        height_field: (resolution, resolution) float64 array, values in
                      [0, thickness] meters. Always returned on CPU.
    """
    xp = _xp()
    fft_mod = _cp_fft if _USE_GPU else cpu_fft
    ndimage_mod = _cp_ndimage if _USE_GPU else cpu_ndimage

    dx = 1.0 / resolution  # UV grid spacing

    # Anisotropic alpha [1/m]: separate for x and y axes
    alpha_x = proj_dist * (n_refract - 1.0) / (physical_size_x ** 2)
    alpha_y = proj_dist * (n_refract - 1.0) / (physical_size_y ** 2)

    if abs(alpha_x) < 1e-12 or abs(alpha_y) < 1e-12:
        raise ValueError("alpha ≈ 0: check refractive index and projection distance.")

    # Load + normalize target intensity (CPU, then move to device)
    I_target_cpu = load_target_image(image_b64, resolution)
    I_target_cpu = normalize_intensity(I_target_cpu, np)
    I_target = _to_device(I_target_cpu)

    # Initialize height field on device
    h = xp.zeros((resolution, resolution), dtype=xp.float64)

    # Precompute anisotropic DCT eigenvalues once
    LAM = _build_aniso_eigenvalues(resolution, resolution, dx, float(alpha_x), float(alpha_y), xp)
    LAM[0, 0] = 1.0
    LAM_inv = 1.0 / LAM
    LAM_inv[0, 0] = 0.0        # zero mean enforced here

    logger.info(
        "Solver start: res=%d ax=%.4e ay=%.4e iter_max=%d device=%s",
        resolution, alpha_x, alpha_y, max_iterations, "GPU" if _USE_GPU else "CPU",
    )

    for iteration in range(max_iterations):
        # Anisotropic Jacobian: J = 1 + alpha_x*h_uu + alpha_y*h_vv
        h_uu, h_vv = compute_second_derivs(h, dx, xp)
        J = 1.0 + alpha_x * h_uu + alpha_y * h_vv
        J = xp.clip(J, 0.05, 40.0)

        # Induced intensity: I = 1/J  (energy conservation)
        I_current = normalize_intensity(1.0 / J, xp)

        # Intensity residual
        error = I_target - I_current
        rms = float(xp.sqrt(xp.mean(error ** 2)))

        if iteration % 20 == 0:
            logger.debug("iter=%d  rms=%.5f", iteration, rms)

        if rms < convergence_tol and iteration > 5:
            logger.info("Converged at iter %d  rms=%.5f", iteration, rms)
            break

        # Anisotropic Poisson step
        delta_h = solve_poisson_aniso(-error, LAM_inv, fft_mod, xp)

        h = h + step_size * delta_h

        # Gaussian regularization
        if smoothing > 0.0:
            h = ndimage_mod.gaussian_filter(
                h, sigma=float(smoothing), mode="reflect"
            )
    else:
        logger.warning("Solver: max iterations reached  rms=%.5f", rms)

    # Normalize output: shift to [0, thickness]
    h_cpu = _to_cpu(h)
    h_cpu = h_cpu - h_cpu.min()
    h_range = h_cpu.max()
    if h_range > 1e-12:
        h_cpu = h_cpu / h_range * thickness
    else:
        logger.warning("Height field near-zero range — target may be too uniform.")

    logger.info("Solver done. h ∈ [%.4e, %.4e]", h_cpu.min(), h_cpu.max())
    return h_cpu

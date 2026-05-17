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
  - Jacobian: J = M² + M*(alpha_x*h_uu + alpha_y*h_vv)
  - Intensity: I = M² / J
  - Transport map: T(u) = u*M + alpha * ∇h  (M = magnification)
"""

from __future__ import annotations

import logging
import base64
import io
import os
import site as _site_mod
from dataclasses import dataclass, field

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


# ── Result dataclass ───────────────────────────────────────────────────────────

@dataclass
class SolverResult:
    height_field: NDArray[np.float64]   # h(u,v) physically correct meters, NOT scaled up
    actual_thickness: float              # h.max() in meters
    converged: bool
    iterations_used: int
    final_rms_error: float
    initial_rms_error: float
    warnings: list[str] = field(default_factory=list)


# ── Main solver ────────────────────────────────────────────────────────────────

def run_solver(
    image_b64: str,
    n_refract: float,
    thickness: float,          # max clamp only, never scale up
    proj_dist: float,
    smoothing: float,          # sigma at start (cools to 0)
    resolution: int,
    physical_size_x: float = 0.05,
    physical_size_y: float = 0.05,
    magnification: float = 1.0,
    max_iterations: int = 200,
    initial_step_size: float = 0.3,
    smoothing_cooldown_iterations: int = 100,
    incident_theta: float = 0.0,
    incident_phi: float = 0.0,
    source_distance: float | None = None,
) -> SolverResult:
    """
    Inverse caustic solver.

    Physics (UV-space formulation with magnification M):
      Transport map: T(u) = u*M + alpha * ∇h
      Jacobian:      J = M² + M*(alpha_x*h_uu + alpha_y*h_vv)
      Energy:        I_caustic = M² / J
      Poisson step:  Δ(δh) = -(error) / max(M, 1.0)
      Update:        h ← h + step_size * δh

      For a point source (spotlight) at distance D above lens:
        L_eff = L*D/(L+D)  — harmonic mean; replaces proj_dist in alpha.
        D→∞ recovers collimated (default).

    Args:
        image_b64:                   Base64-encoded target image.
        n_refract:                   Refractive index (e.g. 1.49 for PETG).
        thickness:                   Max lens height in meters (max clamp only, never scale up).
        proj_dist:                   Projection distance (lens→wall) in meters.
        smoothing:                   Starting Gaussian regularization sigma (cools to 0).
        resolution:                  Solver grid resolution (pixels per side).
        physical_size_x:             Lens width in meters (default 5 cm).
        physical_size_y:             Lens height in meters (default 5 cm).
        magnification:               Image magnification factor M (default 1.0).
        max_iterations:              Maximum solver iterations.
        initial_step_size:           Starting step size (dampened warmstart).
        smoothing_cooldown_iterations: Iterations over which smoothing cools to 0.
        incident_theta:              Incident light elevation from normal (degrees).
        incident_phi:                Incident light azimuth (degrees, 0=+Y).
        source_distance:             Point-source distance above lens (m). None = collimated.

    Returns:
        SolverResult with height field and solver diagnostics.
    """
    xp = _xp()
    fft_mod = _cp_fft if _USE_GPU else cpu_fft
    ndimage_mod = _cp_ndimage if _USE_GPU else cpu_ndimage

    dx = 1.0 / resolution  # UV grid spacing
    M = float(magnification)

    # Effective projection distance: harmonic mean for point source, plain L for collimated
    if source_distance is not None and source_distance > 1e-6:
        eff_proj = proj_dist * source_distance / (proj_dist + source_distance)
    else:
        eff_proj = proj_dist

    # Anisotropic alpha [1/m]: separate for x and y axes
    alpha_x = eff_proj * (n_refract - 1.0) / (physical_size_x ** 2)
    alpha_y = eff_proj * (n_refract - 1.0) / (physical_size_y ** 2)

    if abs(alpha_x) < 1e-12 or abs(alpha_y) < 1e-12:
        raise ValueError("alpha ≈ 0: check refractive index and projection distance.")

    # J clipping bounds based on magnification
    J_min = max(0.05, M * M / 40.0)
    J_max = min(40.0 * M * M, M * M / 0.001)

    # Load + normalize target intensity (CPU, then move to device)
    I_target_cpu = load_target_image(image_b64, resolution)
    I_target_cpu = normalize_intensity(I_target_cpu, np)
    I_target = _to_device(I_target_cpu)

    # Incident light direction shift in UV space
    # theta is elevation from normal, phi is azimuth (0=+Y in UV)
    if incident_theta > 0.0:
        theta_rad = float(incident_theta) * (np.pi / 180.0)
        phi_rad = float(incident_phi) * (np.pi / 180.0)
        # Shift in physical meters on projection plane
        shift_phys = eff_proj * np.tan(theta_rad)
        # Convert to UV shift (UV is [0,1] mapped to physical_size)
        shift_u = shift_phys * np.sin(phi_rad) / physical_size_x
        shift_v = shift_phys * np.cos(phi_rad) / physical_size_y
        # Roll I_target to simulate oblique incidence
        shift_u_px = int(round(shift_u * resolution))
        shift_v_px = int(round(shift_v * resolution))
        I_target = xp.roll(I_target, shift_v_px, axis=0)
        I_target = xp.roll(I_target, shift_u_px, axis=1)

    M2 = M * M  # M squared, used frequently

    # Rescale I_target so mean(I_target_clipped) == M² (energy-consistent).
    # Validated by forward_raytrace experiment: yields higher SSIM than the
    # previous mean(M²/I_target_clipped)==1 formulation on a bimodal target.
    I_target_clipped = xp.clip(I_target, M2 / 40.0, float('inf'))
    clipped_mean = float(I_target_clipped.mean())
    if clipped_mean > 1e-12:
        I_target = I_target * (M2 / clipped_mean)

    # Precompute anisotropic DCT eigenvalues once
    LAM = _build_aniso_eigenvalues(resolution, resolution, dx, float(alpha_x), float(alpha_y), xp)
    LAM[0, 0] = 1.0
    LAM_inv = 1.0 / LAM
    LAM_inv[0, 0] = 0.0        # zero mean enforced here

    # Warmstart: solve Poisson directly for h_0
    I_target_safe = xp.clip(I_target, M2 / 40.0, float('inf'))
    rhs_warm = M * (1.0 / I_target_safe - 1.0)
    rhs_warm = rhs_warm - rhs_warm.mean()
    h_0 = solve_poisson_aniso(rhs_warm, LAM_inv, fft_mod, xp)
    h = h_0 * initial_step_size  # dampened warmstart

    logger.info(
        "Solver start: res=%d M=%.2f ax=%.4e ay=%.4e iter_max=%d device=%s",
        resolution, M, alpha_x, alpha_y, max_iterations, "GPU" if _USE_GPU else "CPU",
    )

    step_size = initial_step_size
    rms_history: list[float] = []
    initial_rms_error = 0.0
    final_rms_error = 0.0
    converged = False
    clipping_active = False
    iterations_used = 0

    for iteration in range(max_iterations):
        # 1. Compute J = M² + M*(alpha_x*h_uu + alpha_y*h_vv)
        h_uu, h_vv = compute_second_derivs(h, dx, xp)
        J = M2 + M * (alpha_x * h_uu + alpha_y * h_vv)

        # 2. Clip J, track if clipping is active
        J_before = J
        J = xp.clip(J, J_min, J_max)
        iter_clipping = bool(xp.any(J_before != J))
        if iter_clipping:
            clipping_active = True

        # 3. I_current = M² / J, normalize so mean = M²
        I_current = M2 / J
        I_current_mean = float(I_current.mean())
        if I_current_mean > 1e-12:
            I_current = I_current * (M2 / I_current_mean)

        # 4. error = I_target - I_current
        error = I_target - I_current

        # 5. Solvability constraint: error -= error.mean()
        error = error - error.mean()

        rms = float(xp.sqrt(xp.mean(error ** 2)))

        if iteration == 0:
            initial_rms_error = rms

        if iteration % 20 == 0:
            logger.debug("iter=%d  rms=%.5f  step=%.4f", iteration, rms, step_size)

        # Check convergence
        if iteration > 5 and initial_rms_error > 1e-12:
            # Relative convergence
            if rms > 0.0 and rms / initial_rms_error < 1e-3:
                converged = True
                iterations_used = iteration + 1
                final_rms_error = rms
                logger.info("Converged (relative) at iter %d  rms=%.5f", iteration, rms)
                break
            # Stagnation check over last 5 iterations
            if len(rms_history) >= 5:
                last5_mean = sum(rms_history[-5:]) / 5.0
                if last5_mean > 1e-12 and abs(rms - last5_mean) / rms < 1e-4:
                    converged = True
                    iterations_used = iteration + 1
                    final_rms_error = rms
                    logger.info("Converged (stagnation) at iter %d  rms=%.5f", iteration, rms)
                    break

        rms_history.append(rms)

        # 6. Poisson step: delta_h = solve_poisson_aniso(-error / max(M, 1.0), ...)
        delta_h = solve_poisson_aniso(-error / max(M, 1.0), LAM_inv, fft_mod, xp)

        # 7. Update h
        h = h + step_size * delta_h

        # 8. Adaptive step size
        if len(rms_history) >= 2 and rms > rms_history[-2]:
            step_size *= 0.5
        else:
            step_size = min(step_size * 1.05, 0.7)

        # 9. Cooling smoothing
        sigma_k = smoothing * max(0.0, 1.0 - iteration / max(1, smoothing_cooldown_iterations))
        if sigma_k > 0.1:
            h = ndimage_mod.gaussian_filter(h, sigma=float(sigma_k), mode="reflect")

    else:
        # Max iterations reached
        iterations_used = max_iterations
        final_rms_error = rms_history[-1] if rms_history else 0.0
        logger.warning("Solver: max iterations reached  rms=%.5f", final_rms_error)

    if not converged and iterations_used == 0:
        iterations_used = max_iterations

    # ── Output normalization (CRITICAL — no upscaling, only clamp down) ────────
    h_cpu = _to_cpu(h)
    h_cpu = h_cpu - h_cpu.min()
    actual_thickness = float(h_cpu.max())

    solver_warnings: list[str] = []

    if actual_thickness < 1e-12:
        logger.warning("Height field near-zero range — target may be too uniform.")
        actual_thickness = 0.0

    if actual_thickness > thickness:
        # Only clamp DOWN when natural height exceeds the user's max
        effective_L = proj_dist * (thickness / actual_thickness)
        solver_warnings.append(
            f"Natural thickness {actual_thickness*1000:.2f}mm exceeds max {thickness*1000:.1f}mm. "
            f"Clamping: effective projection distance becomes {effective_L*100:.1f}cm instead of {proj_dist*100:.1f}cm. "
            f"Consider increasing projection distance or reducing magnification."
        )
        h_cpu = h_cpu * (thickness / actual_thickness)
        actual_thickness = thickness
    else:
        logger.info(
            "Height field physical: %.4e m (max allowed %.4e m) — L_eff = L",
            actual_thickness, thickness,
        )

    if clipping_active:
        solver_warnings.append(
            "J clipping active — target contrast exceeds physical limit. Effective contrast reduced."
        )

    logger.info("Solver done. h ∈ [%.4e, %.4e]  converged=%s  iters=%d",
                h_cpu.min(), h_cpu.max(), converged, iterations_used)

    return SolverResult(
        height_field=h_cpu,
        actual_thickness=actual_thickness,
        converged=converged,
        iterations_used=iterations_used,
        final_rms_error=final_rms_error,
        initial_rms_error=initial_rms_error,
        warnings=solver_warnings,
    )

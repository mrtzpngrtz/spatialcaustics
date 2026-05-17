"""
Independent Snell-based forward ray tracer for caustic validation.
Does NOT reuse the paraxial Monge-Ampere model used by the solver.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import map_coordinates


def forward_raytrace(
    h: NDArray[np.float64],
    lens_size_m: float,
    projection_distance_m: float,
    refractive_index: float,
    target_resolution: int,
    n_rays: int = 1_000_000,
) -> tuple[NDArray[np.float64], float]:
    """
    Independent Snell-based forward simulation.
    Does NOT reuse the paraxial Monge-Ampere model.

    For each ray: sample (u,v) uniformly in [0,1]^2, compute surface
    normal from bilinear-interpolated gradient of h, apply full vector
    Snell's law (Glassner 1989), propagate to z=-projection_distance_m,
    bilinear splat into 2D histogram.

    Args:
        h:                      Height field (ny, nx), meters.
        lens_size_m:            Physical lens side length (m). Square lens assumed.
        projection_distance_m:  Distance from lens to projection plane (m).
        refractive_index:       n of the lens material (e.g. 1.49 for PETG).
        target_resolution:      Output image side length in pixels.
        n_rays:                 Number of Monte Carlo rays.

    Returns:
        simulated_intensity: 2D array (target_resolution, target_resolution),
                             normalized so mean == 1.0.
        energy_conservation_ratio: fraction of rays landing on the projection
                             area; should be close to 1.0 for a well-designed lens.
    """
    ny, nx = h.shape

    # Physical grid spacing (meters per pixel)
    dx = lens_size_m / max(nx - 1, 1)
    dy = lens_size_m / max(ny - 1, 1)

    # Gradient of h in physical units: slope = dh/d(physical coord), dimensionless
    # np.gradient(h, dy, dx) → [dh_dy (axis-0), dh_dx (axis-1)]
    grads = np.gradient(h, dy, dx)
    dh_dy, dh_dx = grads[0], grads[1]

    # Sample n_rays uniformly in [0, 1]^2
    rng = np.random.default_rng(42)
    uv = rng.random((n_rays, 2))
    u = uv[:, 0]   # normalized x in [0, 1]
    v = uv[:, 1]   # normalized y in [0, 1]

    # Pixel coords for bilinear interpolation: h[row, col] = h(y, x)
    col = u * (nx - 1)
    row = v * (ny - 1)
    coords = np.vstack([row, col])   # shape (2, n_rays)

    gx = map_coordinates(dh_dx, coords, order=1, mode='nearest')
    gy = map_coordinates(dh_dy, coords, order=1, mode='nearest')

    # Surface normal: n_hat = normalize((-dh/dx, -dh/dy, 1))
    mag = np.sqrt(gx * gx + gy * gy + 1.0)
    nnx = -gx / mag
    nny = -gy / mag
    nnz = 1.0 / mag   # always positive (normal points toward incident light)

    # Vector Snell's law (Glassner 1989):
    #   incident direction d = (0, 0, -1)
    #   cos_i = -dot(d, n_hat) = nnz
    #   r = n1/n2 = 1/n_refract
    #   k = 1 - r^2 * (1 - cos_i^2)
    #   t = r*d + (r*cos_i - sqrt(k)) * n_hat
    r = 1.0 / refractive_index
    cos_i = nnz
    k = 1.0 - r * r * (1.0 - cos_i * cos_i)
    coeff = r * cos_i - np.sqrt(np.maximum(k, 0.0))   # clamp for TIR

    # d = (0, 0, -1), so r*d = (0, 0, -r)
    tx = coeff * nnx
    ty = coeff * nny
    tz = -r + coeff * nnz   # always negative for well-behaved angles

    # Propagate to z = -projection_distance_m
    # t_param = proj_dist / |tz|
    valid = tz < -1e-10
    t_param = np.where(valid, -projection_distance_m / tz, 0.0)

    x_land = u * lens_size_m + t_param * tx
    y_land = v * lens_size_m + t_param * ty

    # Map landing position to target pixel coordinates
    ix_f = x_land / lens_size_m * target_resolution
    iy_f = y_land / lens_size_m * target_resolution

    in_bounds = (
        valid
        & (ix_f >= 0.0) & (ix_f < target_resolution)
        & (iy_f >= 0.0) & (iy_f < target_resolution)
    )
    ix_f = ix_f[in_bounds]
    iy_f = iy_f[in_bounds]

    # Bilinear splat into 2D histogram
    ix0 = np.floor(ix_f).astype(np.int32)
    iy0 = np.floor(iy_f).astype(np.int32)
    ix1 = np.minimum(ix0 + 1, target_resolution - 1)
    iy1 = np.minimum(iy0 + 1, target_resolution - 1)
    wx1 = ix_f - ix0
    wx0 = 1.0 - wx1
    wy1 = iy_f - iy0
    wy0 = 1.0 - wy1

    intensity = np.zeros((target_resolution, target_resolution), dtype=np.float64)
    np.add.at(intensity, (iy0, ix0), wx0 * wy0)
    np.add.at(intensity, (iy0, ix1), wx1 * wy0)
    np.add.at(intensity, (iy1, ix0), wx0 * wy1)
    np.add.at(intensity, (iy1, ix1), wx1 * wy1)

    energy_ratio = float(in_bounds.sum()) / n_rays

    # Normalize so mean == 1.0 (caller rescales to match target mean)
    mean_val = intensity.mean()
    if mean_val > 1e-12:
        intensity = intensity / mean_val

    return intensity, energy_ratio

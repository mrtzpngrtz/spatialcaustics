"""
CPU-side caustic forward pass for validation.

Given h(x,y), traces paraxial rays through the lens and accumulates
energy on the projection screen using splatting (bilinear deposit).
Returns a normalized intensity image.
"""

import numpy as np
from numpy.typing import NDArray
import base64
import io
from PIL import Image


def forward_caustic(
    h: NDArray[np.float64],
    n_refract: float,
    proj_dist: float,
    output_resolution: int | None = None,
    physical_size_x: float = 0.05,
    physical_size_y: float = 0.05,
    source_distance: float | None = None,
    magnification: float = 1.0,
) -> NDArray[np.float64]:
    """
    Caustic intensity via Jacobian of the transport map (paraxial approximation).

    Transport map: T(u) = u*M + alpha * gradient
    Jacobian: J = M² + M*(alpha_x*h_uu + alpha_y*h_vv)
    I(x) = M² / J

    This is the same model used by the solver's internal energy model.

    Args:
        h:                 Height field (ny, nx), meters.
        n_refract:         Refractive index.
        proj_dist:         Projection distance (meters).
        output_resolution: Output size in pixels. Defaults to h.shape[0].
        physical_size_x:   Lens width in meters.
        physical_size_y:   Lens height in meters.
        source_distance:   Point-source distance above lens (m). None = collimated.
        magnification:     Image magnification factor M.

    Returns:
        Intensity image (res, res), float64 in [0, 1].
    """
    if source_distance is not None and source_distance > 1e-6:
        eff_proj = proj_dist * source_distance / (proj_dist + source_distance)
    else:
        eff_proj = proj_dist
    alpha_x = eff_proj * (n_refract - 1.0) / (physical_size_x ** 2)
    alpha_y = eff_proj * (n_refract - 1.0) / (physical_size_y ** 2)

    M = float(magnification)
    M2 = M * M

    ny, nx = h.shape
    dx = 1.0 / max(nx, ny)
    dx2 = dx * dx

    # Anisotropic second derivatives with Neumann BC
    h_uu = (np.roll(h, -1, axis=1) + np.roll(h, 1, axis=1) - 2.0 * h) / dx2
    h_vv = (np.roll(h, -1, axis=0) + np.roll(h, 1, axis=0) - 2.0 * h) / dx2
    for arr in (h_uu, h_vv):
        arr[:,  0] = arr[:,  1]; arr[:, -1] = arr[:, -2]
        arr[ 0, :] = arr[ 1, :]; arr[-1, :] = arr[-2, :]

    # Jacobian with magnification: J = M² + M*(alpha_x*h_uu + alpha_y*h_vv)
    J = M2 + M * (alpha_x * h_uu + alpha_y * h_vv)
    J_min = max(0.05, M2 / 40.0)
    J_max = min(40.0 * M2, M2 / 0.001)
    J = np.clip(J, J_min, J_max)
    intensity = M2 / J

    # Normalize to [0, 1]
    i_max = intensity.max()
    if i_max > 1e-12:
        intensity = intensity / i_max

    # Resize to square output_resolution (caller handles aspect ratio for display)
    res = output_resolution or ny
    if res != ny or res != nx:
        from PIL import Image as _Image
        img = _Image.fromarray((intensity * 255).astype(np.uint8), mode="L")
        img = img.resize((res, res), _Image.LANCZOS)
        intensity = np.array(img, dtype=np.float64) / 255.0

    return intensity


def simulate_to_base64(
    h: NDArray[np.float64],
    n_refract: float,
    proj_dist: float,
    output_resolution: int = 512,
    physical_size_x: float = 0.05,
    physical_size_y: float = 0.05,
    source_distance: float | None = None,
    magnification: float = 1.0,
) -> str:
    """
    Run forward simulation and return a base64-encoded PNG with the correct
    physical aspect ratio (width : height = physical_size_x : physical_size_y).
    """
    intensity = forward_caustic(
        h, n_refract, proj_dist, output_resolution,
        physical_size_x, physical_size_y, source_distance, magnification
    )

    # Resize to physically correct aspect ratio
    aspect = physical_size_x / physical_size_y
    if aspect >= 1.0:
        out_w = output_resolution
        out_h = max(1, round(output_resolution / aspect))
    else:
        out_h = output_resolution
        out_w = max(1, round(output_resolution * aspect))

    img_arr = (intensity * 255.0).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(img_arr, mode="L")
    if (out_w, out_h) != (img.width, img.height):
        img = img.resize((out_w, out_h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")

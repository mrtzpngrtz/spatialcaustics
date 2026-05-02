"""
Height field → watertight STL export.

Topology (lens):
  - Top surface:  height field triangles (free-form lens surface)
  - Bottom surface: flat base at z = -base_thickness
  - Side walls: connecting top perimeter to bottom perimeter (4 walls)

Topology (mold):
  - Cavity floor: inverted height field (neg_h = thickness - h), offset by wall_thickness
  - Cavity inner walls: vertical walls from cavity edges up to z_rim
  - Outer walls: full outer rectangle from z_bot to z_rim
  - Top rim: flat frame at z_rim between outer and inner boundaries
  - Bottom: full outer rectangle at z_bot

All faces oriented outward (right-hand normal convention).
"""

import numpy as np
from numpy.typing import NDArray
import io
from stl import mesh as stl_mesh
from stl import stl as stl_stl


def _triangulate_grid(
    vertices: NDArray[np.float64],
    ny: int,
    nx: int,
    flip_normals: bool = False,
) -> NDArray[np.float64]:
    """
    Triangulate a regular (ny × nx) grid of vertices into triangles.
    Each quad cell → 2 triangles (CCW winding when viewed from +z).

    vertices: (ny*nx, 3) array of 3D points
    Returns: (N_triangles, 3, 3) array of triangle vertices.
    """
    triangles = []
    for i in range(ny - 1):
        for j in range(nx - 1):
            # Vertex indices in the flat array
            i0 = i * nx + j        # bottom-left
            i1 = i * nx + (j + 1)  # bottom-right
            i2 = (i + 1) * nx + j       # top-left
            i3 = (i + 1) * nx + (j + 1) # top-right

            v0, v1, v2, v3 = vertices[i0], vertices[i1], vertices[i2], vertices[i3]

            if not flip_normals:
                # CCW from above → normal points +z
                triangles.append([v0, v1, v3])
                triangles.append([v0, v3, v2])
            else:
                # CW from above → normal points -z (for bottom face)
                triangles.append([v0, v3, v1])
                triangles.append([v0, v2, v3])

    return np.array(triangles, dtype=np.float64)


def _side_wall_quads(
    top_edge: NDArray[np.float64],
    bot_edge: NDArray[np.float64],
    inward: bool = False,
) -> NDArray[np.float64]:
    """
    Build triangles for a wall between two polylines (top_edge and bot_edge).
    Both arrays have shape (N, 3).
    Normals point outward unless inward=True.
    """
    triangles = []
    N = len(top_edge)
    for k in range(N - 1):
        t0 = top_edge[k]
        t1 = top_edge[k + 1]
        b0 = bot_edge[k]
        b1 = bot_edge[k + 1]

        if not inward:
            triangles.append([t0, b0, t1])
            triangles.append([t1, b0, b1])
        else:
            triangles.append([t0, t1, b0])
            triangles.append([t1, b1, b0])

    return np.array(triangles, dtype=np.float64)


def height_field_to_stl(
    height_field: NDArray[np.float64],
    thickness: float,
    base_thickness: float,
    physical_size: float = 0.05,
    physical_size_y: float | None = None,
    base_curve_radius: float | None = None,
) -> bytes:
    """
    Convert a height field to a watertight STL binary file.

    Args:
        height_field:   (ny, nx) array of surface heights in meters.
        thickness:      Maximum lens height (meters).
        base_thickness: Flat base thickness (meters).
        physical_size:  Lens width in meters (x axis).
        physical_size_y: Lens depth in meters (y axis). Defaults to physical_size.
    """
    # Convert all physical dimensions to mm for slicer compatibility
    size_x = physical_size * 1000.0
    size_y = (physical_size_y if physical_size_y is not None else physical_size) * 1000.0
    base_thickness_mm = base_thickness * 1000.0
    h_mm = height_field * 1000.0

    ny, nx = h_mm.shape

    # --- Build vertex grids ---
    xs = np.linspace(0.0, size_x, nx)
    ys = np.linspace(0.0, size_y, ny)
    xg, yg = np.meshgrid(xs, ys)

    top_verts = np.stack([
        xg.ravel(),
        yg.ravel(),
        h_mm.ravel(),
    ], axis=1)  # (ny*nx, 3)

    # Bottom surface: flat or spherical base curve
    if base_curve_radius is not None:
        cx, cy = size_x / 2, size_y / 2
        R = abs(base_curve_radius) * 1000.0
        sag = R - np.sqrt(np.maximum(R**2 - (xg - cx)**2 - (yg - cy)**2, 0.0))
        bot_z = (-base_thickness_mm + sag).ravel()
    else:
        bot_z = np.full(nx * ny, -base_thickness_mm)
    bot_verts = np.stack([
        xg.ravel(),
        yg.ravel(),
        bot_z,
    ], axis=1)  # (ny*nx, 3)

    # --- Triangulate surfaces ---
    top_tris = _triangulate_grid(top_verts, ny, nx, flip_normals=False)
    bot_tris = _triangulate_grid(bot_verts, ny, nx, flip_normals=True)

    # --- Side walls (4 edges of the rectangular lens) ---
    # Extract perimeter edges: j iterates along row/column index

    # Bottom edge of grid (i=0): y=0, j from 0 to nx-1
    top_bottom_edge = top_verts[:nx]
    bot_bottom_edge = bot_verts[:nx]

    # Top edge of grid (i=ny-1): y=size_y, j from 0 to nx-1
    top_top_edge = top_verts[(ny - 1) * nx: ny * nx]
    bot_top_edge = bot_verts[(ny - 1) * nx: ny * nx]

    # Left edge (j=0): x=0, i from 0 to ny-1
    top_left_edge = top_verts[np.arange(ny) * nx]
    bot_left_edge = bot_verts[np.arange(ny) * nx]

    # Right edge (j=nx-1): x=size_x, i from 0 to ny-1
    top_right_edge = top_verts[np.arange(ny) * nx + (nx - 1)]
    bot_right_edge = bot_verts[np.arange(ny) * nx + (nx - 1)]

    # Wall normals: outward = away from lens center
    # Bottom wall (y=0): normal -y → inward=False with reversed orientation
    wall_bottom = _side_wall_quads(top_bottom_edge, bot_bottom_edge, inward=True)
    # Top wall (y=phys): normal +y
    wall_top = _side_wall_quads(top_top_edge[::-1], bot_top_edge[::-1], inward=True)
    # Left wall (x=0): normal -x
    wall_left = _side_wall_quads(top_left_edge[::-1], bot_left_edge[::-1], inward=True)
    # Right wall (x=phys): normal +x
    wall_right = _side_wall_quads(top_right_edge, bot_right_edge, inward=True)

    # --- Concatenate all triangles ---
    all_tris = np.concatenate([
        top_tris,
        bot_tris,
        wall_bottom,
        wall_top,
        wall_left,
        wall_right,
    ], axis=0)  # (N_total, 3, 3)

    # --- Build numpy-stl mesh ---
    n_tris = len(all_tris)
    obj = stl_mesh.Mesh(np.zeros(n_tris, dtype=stl_mesh.Mesh.dtype))

    for i, tri in enumerate(all_tris):
        obj.vectors[i] = tri

    obj.update_normals()

    # --- Serialize to bytes ---
    buf = io.BytesIO()
    obj.save("caustic_lens.stl", fh=buf, mode=stl_stl.Mode.BINARY)
    return buf.getvalue()


def height_field_to_mold_stl(
    height_field: NDArray[np.float64],
    thickness: float,
    base_thickness: float,
    physical_size_x: float,
    physical_size_y: float,
    border_height: float,
    wall_thickness: float = 0.003,
) -> bytes:
    """
    Build a casting mold (negative) with raised border walls.

    The mold is a rectangular tray:
      - Outer footprint: (physical_size_x + 2*wall_thickness) × (physical_size_y + 2*wall_thickness)
      - Inner cavity: inverted lens surface (neg_h = thickness - height_field)
      - Wall height above cavity: border_height
      - Open top for pouring epoxy

    Pouring epoxy and curing produces the lens.
    """
    # Convert all physical dimensions to mm
    neg_h = (thickness - height_field) * 1000.0
    ny, nx = neg_h.shape
    sx  = physical_size_x  * 1000.0
    sy  = physical_size_y  * 1000.0
    wt  = wall_thickness   * 1000.0
    W   = sx + 2 * wt
    H   = sy + 2 * wt
    z_rim = (thickness + border_height) * 1000.0
    z_bot = -base_thickness * 1000.0

    # ── Cavity floor (neg_h grid, shifted by wt) ──────────────────────────────
    xs = np.linspace(wt, wt + sx, nx)
    ys = np.linspace(wt, wt + sy, ny)
    xg, yg = np.meshgrid(xs, ys)
    cav_verts = np.stack([xg.ravel(), yg.ravel(), neg_h.ravel()], axis=1)
    # flip_normals=False → CCW from above → normal +z (into cavity from below) ✓
    cav_tris = _triangulate_grid(cav_verts, ny, nx, flip_normals=False)

    # ── Cavity inner walls (from cavity edge heights up to z_rim) ─────────────
    # Front wall (y=wt, normal +y into cavity)
    fe_bot = cav_verts[:nx]
    fe_top = np.stack([xs, np.full(nx, wt), np.full(nx, z_rim)], axis=1)
    inner_front = _side_wall_quads(fe_top, fe_bot, inward=True)   # normal +y ✓

    # Back wall (y=wt+sy, normal -y into cavity) — reversed traversal
    be_bot = cav_verts[(ny - 1) * nx:]
    be_top = np.stack([xs, np.full(nx, wt + sy), np.full(nx, z_rim)], axis=1)
    inner_back = _side_wall_quads(be_top[::-1], be_bot[::-1], inward=True)  # normal -y ✓

    # Left wall (x=wt, normal +x into cavity)
    le_bot = cav_verts[np.arange(ny) * nx]
    le_top = np.stack([np.full(ny, wt), ys, np.full(ny, z_rim)], axis=1)
    inner_left = _side_wall_quads(le_top, le_bot, inward=False)   # normal +x ✓

    # Right wall (x=wt+sx, normal -x into cavity) — reversed traversal
    re_bot = cav_verts[np.arange(ny) * nx + (nx - 1)]
    re_top = np.stack([np.full(ny, wt + sx), ys, np.full(ny, z_rim)], axis=1)
    inner_right = _side_wall_quads(re_top[::-1], re_bot[::-1], inward=False)  # normal -x ✓

    # ── Outer walls (full outer rectangle, z_bot → z_rim) ────────────────────
    def _flat_quad(p0, p1, p2, p3) -> NDArray[np.float64]:
        """Two triangles for a planar quad (CCW winding = outward normal)."""
        return np.array([[p0, p1, p2], [p0, p2, p3]], dtype=np.float64)

    outer_front = _flat_quad([0, 0, z_rim], [0, 0, z_bot], [W, 0, z_bot], [W, 0, z_rim])   # -y
    outer_back  = _flat_quad([0, H, z_rim], [W, H, z_rim], [W, H, z_bot], [0, H, z_bot])   # +y
    outer_left  = _flat_quad([0, H, z_rim], [0, H, z_bot], [0, 0, z_bot], [0, 0, z_rim])   # -x
    outer_right = _flat_quad([W, 0, z_rim], [W, 0, z_bot], [W, H, z_bot], [W, H, z_rim])   # +x

    # ── Top rim (flat frame at z_rim, normal +z) ──────────────────────────────
    def _rim_quad(x0: float, y0: float, x1: float, y1: float) -> NDArray[np.float64]:
        """Flat quad at z_rim with normal +z (CCW from above)."""
        return np.array([
            [[x0, y0, z_rim], [x1, y0, z_rim], [x1, y1, z_rim]],
            [[x0, y0, z_rim], [x1, y1, z_rim], [x0, y1, z_rim]],
        ], dtype=np.float64)

    rim_front = _rim_quad(0,      0,       W,       wt)
    rim_back  = _rim_quad(0,      wt + sy, W,       H)
    rim_left  = _rim_quad(0,      wt,      wt,      wt + sy)
    rim_right = _rim_quad(wt + sx, wt,     W,       wt + sy)

    # ── Bottom face (full W×H rectangle, normal -z) ───────────────────────────
    bot_tris = np.array([
        [[0, 0, z_bot], [W, H, z_bot], [W, 0, z_bot]],
        [[0, 0, z_bot], [0, H, z_bot], [W, H, z_bot]],
    ], dtype=np.float64)

    # ── Assemble and export ───────────────────────────────────────────────────
    all_tris = np.concatenate([
        cav_tris,
        inner_front, inner_back, inner_left, inner_right,
        outer_front, outer_back, outer_left, outer_right,
        rim_front, rim_back, rim_left, rim_right,
        bot_tris,
    ], axis=0)

    n_tris = len(all_tris)
    obj = stl_mesh.Mesh(np.zeros(n_tris, dtype=stl_mesh.Mesh.dtype))
    for i, tri in enumerate(all_tris):
        obj.vectors[i] = tri
    obj.update_normals()

    buf = io.BytesIO()
    obj.save("caustic_mold.stl", fh=buf, mode=stl_stl.Mode.BINARY)
    return buf.getvalue()


def height_field_to_container_stl(
    physical_size_x: float,
    physical_size_y: float,
    lens_total_thickness: float,
    wall_thickness: float = 0.003,
    bottom_height: float = 0.002,
    clearance: float = 0.0003,
    base_thickness: float = 0.002,  # kept for API compat, unused
) -> bytes:
    """
    Holder that the finished lens sits in.

    Geometry (all dims in mm internally):
      - Outer footprint: (sx + 2*wt) × (sy + 2*wt)
      - Solid base: bottom_height tall
      - Pocket: lens_total_thickness deep, centered, with clearance on each side
    """
    # All coordinates in mm
    sx  = physical_size_x  * 1000.0
    sy  = physical_size_y  * 1000.0
    wt  = wall_thickness   * 1000.0
    bh  = bottom_height    * 1000.0
    lt  = lens_total_thickness * 1000.0
    cl  = max(0.0, clearance * 1000.0)
    W   = sx + 2.0 * wt
    H   = sy + 2.0 * wt
    zpf = bh            # pocket floor z
    zt  = bh + lt       # top of holder

    # Pocket inner edges (with clearance, clamped)
    ix0 = max(1e-6, wt - cl)
    iy0 = max(1e-6, wt - cl)
    ix1 = min(W - 1e-6, wt + sx + cl)
    iy1 = min(H - 1e-6, wt + sy + cl)

    def fq(p0, p1, p2, p3) -> NDArray[np.float64]:
        """2 triangles from quad. Normal from right-hand rule on p0,p1,p2."""
        a, b, c, d = (np.array(p, dtype=np.float64) for p in (p0, p1, p2, p3))
        return np.array([[a, b, c], [a, c, d]], dtype=np.float64)

    # ── Bottom face (z=0, full W×H, -z normal) ────────────────────────────────
    bot = fq([0,0,0], [0,H,0], [W,H,0], [W,0,0])

    # ── Outer walls (z=0 → zt) ────────────────────────────────────────────────
    o_front = fq([0,0,0],[W,0,0],[W,0,zt],[0,0,zt])   # -y
    o_back  = fq([W,H,0],[0,H,0],[0,H,zt],[W,H,zt])   # +y
    o_left  = fq([0,H,0],[0,0,0],[0,0,zt],[0,H,zt])   # -x
    o_right = fq([W,0,0],[W,H,0],[W,H,zt],[W,0,zt])   # +x

    # ── Mid-rim frame + pocket floor at z=zpf (+z normal) ─────────────────────
    def mq(x0: float, y0: float, x1: float, y1: float) -> NDArray[np.float64]:
        return fq([x0,y0,zpf], [x1,y0,zpf], [x1,y1,zpf], [x0,y1,zpf])

    mid = np.concatenate([
        mq(0,   0,   W,   iy0),   # front strip
        mq(0,   iy1, W,   H),     # back strip
        mq(0,   iy0, ix0, iy1),   # left strip
        mq(ix1, iy0, W,   iy1),   # right strip
        mq(ix0, iy0, ix1, iy1),   # pocket floor
    ])

    # ── Inner pocket walls (z=zpf → zt, normals into pocket) ─────────────────
    i_front = fq([ix1,iy0,zpf],[ix0,iy0,zpf],[ix0,iy0,zt],[ix1,iy0,zt])  # +y
    i_back  = fq([ix0,iy1,zpf],[ix1,iy1,zpf],[ix1,iy1,zt],[ix0,iy1,zt])  # -y
    i_left  = fq([ix0,iy0,zpf],[ix0,iy1,zpf],[ix0,iy1,zt],[ix0,iy0,zt])  # +x
    i_right = fq([ix1,iy1,zpf],[ix1,iy0,zpf],[ix1,iy0,zt],[ix1,iy1,zt])  # -x

    # ── Top rim frame (z=zt, +z normal) ───────────────────────────────────────
    def tq(x0: float, y0: float, x1: float, y1: float) -> NDArray[np.float64]:
        return fq([x0,y0,zt], [x1,y0,zt], [x1,y1,zt], [x0,y1,zt])

    rim = np.concatenate([
        tq(0,   0,   W,   iy0),
        tq(0,   iy1, W,   H),
        tq(0,   iy0, ix0, iy1),
        tq(ix1, iy0, W,   iy1),
    ])

    all_tris = np.concatenate([
        bot, o_front, o_back, o_left, o_right,
        mid, i_front, i_back, i_left, i_right,
        rim,
    ])

    n_tris = len(all_tris)
    obj = stl_mesh.Mesh(np.zeros(n_tris, dtype=stl_mesh.Mesh.dtype))
    for i, tri in enumerate(all_tris):
        obj.vectors[i] = tri
    obj.update_normals()

    buf = io.BytesIO()
    obj.save("caustic_holder.stl", fh=buf, mode=stl_stl.Mode.BINARY)
    return buf.getvalue()

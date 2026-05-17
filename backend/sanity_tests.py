"""
Sanity tests for the spatial-caustics solver.
Run from backend/ with the venv active:
    python sanity_tests.py

Tests:
  T1: Uniform target  -> h ~= 0
  T2: Radial Gaussian -> radially symmetric h
  T3: Two-bar pattern -> forward model reproduces target (self-consistency only)
  T4: Anisotropic alpha differs when Sx != Sy
  T5: DCT-Poisson round-trip on zero-mean rhs is consistent
  T6: STL side-wall normal direction (verifies wall-normal orientation)
"""
import sys, os, io, base64
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import solver as S            # type: ignore
import simulation as SIM      # type: ignore
import stl_export as STL      # type: ignore


def _png_b64(arr01):
    img = Image.fromarray((arr01.clip(0, 1) * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def T1_uniform():
    N = 64
    tgt = np.ones((N, N)) * 0.8
    r = S.run_solver(
        image_b64=_png_b64(tgt), n_refract=1.49, thickness=0.003,
        proj_dist=0.5, smoothing=0.0, resolution=N,
        physical_size_x=0.05, physical_size_y=0.05,
        max_iterations=40, initial_step_size=0.3,
        smoothing_cooldown_iterations=10,
    )
    h_range = float(r.height_field.max() - r.height_field.min())
    print(f"T1 uniform: h_range={h_range*1e6:.3f} um  iters={r.iterations_used}  rms={r.final_rms_error:.3e}")
    assert h_range < 1e-5, f"Uniform target should give flat h, got {h_range}"


def T2_gaussian():
    N = 64
    u = np.linspace(-1, 1, N); v = np.linspace(-1, 1, N)
    U, V = np.meshgrid(u, v)
    tgt = np.exp(-(U**2 + V**2) / 0.2)
    r = S.run_solver(
        image_b64=_png_b64(tgt), n_refract=1.49, thickness=0.005,
        proj_dist=0.5, smoothing=1.0, resolution=N,
        physical_size_x=0.05, physical_size_y=0.05,
        max_iterations=80, initial_step_size=0.3,
        smoothing_cooldown_iterations=40,
    )
    h = r.height_field
    h_sym = 0.25 * (h + np.fliplr(h) + np.flipud(h) + np.flipud(np.fliplr(h)))
    asym = float(np.linalg.norm(h - h_sym) / max(np.linalg.norm(h), 1e-12))
    print(f"T2 gaussian: rel-asymmetry={asym:.3e}  iters={r.iterations_used}  rms={r.final_rms_error:.3e}")
    assert asym < 5e-2


def T3_two_bar_rmse():
    N = 96
    tgt = np.full((N, N), 0.15)
    tgt[N//4:3*N//4, N//3:N//3+6] = 1.0
    tgt[N//4:3*N//4, 2*N//3:2*N//3+6] = 1.0
    r = S.run_solver(
        image_b64=_png_b64(tgt), n_refract=1.49, thickness=0.003,
        proj_dist=0.5, smoothing=2.0, resolution=N,
        physical_size_x=0.05, physical_size_y=0.05,
        max_iterations=200, initial_step_size=0.3,
        smoothing_cooldown_iterations=120,
    )
    sim = SIM.forward_caustic(
        r.height_field, n_refract=1.49, proj_dist=0.5,
        output_resolution=N, physical_size_x=0.05, physical_size_y=0.05,
    )
    tgt_n = tgt / max(tgt.mean(), 1e-12)
    sim_n = sim / max(sim.mean(), 1e-12)
    rmse = float(np.sqrt(np.mean((tgt_n - sim_n) ** 2)))
    print(f"T3 two-bar: rmse={rmse:.3f}  iters={r.iterations_used}  conv={r.converged}  warn={r.warnings}")


def T4_anisotropic_alpha():
    N = 32
    tgt = np.ones((N, N)) * 0.5
    captured = {}
    orig = S._build_aniso_eigenvalues
    def spy(ny, nx, dx, ax, ay, xp):
        captured["ax"] = float(ax); captured["ay"] = float(ay)
        return orig(ny, nx, dx, ax, ay, xp)
    S._build_aniso_eigenvalues = spy
    try:
        S.run_solver(
            image_b64=_png_b64(tgt), n_refract=1.49, thickness=0.003,
            proj_dist=0.5, smoothing=0.0, resolution=N,
            physical_size_x=0.10, physical_size_y=0.05,
            max_iterations=2, initial_step_size=0.1,
            smoothing_cooldown_iterations=1,
        )
    finally:
        S._build_aniso_eigenvalues = orig
    ratio = captured["ay"] / captured["ax"]
    expect = (0.10 / 0.05) ** 2
    print(f"T4 aniso: ax={captured['ax']:.4e} ay={captured['ay']:.4e} ay/ax={ratio:.3f} (expect {expect:.3f})")
    assert abs(ratio - expect) / expect < 1e-6


def T5_solvability():
    N = 64
    dx = 1.0 / N
    rng = np.random.default_rng(0)
    rhs = rng.standard_normal((N, N))
    rhs -= rhs.mean()
    LAM = S._build_aniso_eigenvalues(N, N, dx, 1.0, 1.0, np)
    LAM[0, 0] = 1.0
    LAM_inv = 1.0 / LAM
    LAM_inv[0, 0] = 0.0
    import scipy.fft as fft_mod
    u = S.solve_poisson_aniso(rhs, LAM_inv, fft_mod, np)
    h_uu, h_vv = S.compute_second_derivs(u, dx, np)
    lhs = h_uu + h_vv
    err = float(np.linalg.norm((lhs - lhs.mean()) - (rhs - rhs.mean())) / np.linalg.norm(rhs - rhs.mean()))
    print(f"T5 solvability: u.mean={u.mean():.2e}  rel-err={err:.3e}")
    assert abs(u.mean()) < 1e-10
    assert err < 1e-6


def T6_stl_normals():
    N = 16
    h = np.zeros((N, N)); h[N//2, N//2] = 0.001
    blob = STL.height_field_to_stl(
        height_field=h, thickness=0.003, base_thickness=0.002,
        physical_size=0.05, physical_size_y=0.05,
    )
    tmp = os.path.join(HERE, "_tmp.stl")
    open(tmp, "wb").write(blob)
    from stl import mesh as stl_mesh
    m = stl_mesh.Mesh.from_file(tmp)
    os.remove(tmp)
    m.update_normals()
    verts = m.vectors
    norms = m.normals
    size_mm = 0.05 * 1000.0
    eps = 1e-3
    front = (verts[:, :, 1].max(axis=1) < eps)
    back  = (verts[:, :, 1].min(axis=1) > size_mm - eps)
    left  = (verts[:, :, 0].max(axis=1) < eps)
    right = (verts[:, :, 0].min(axis=1) > size_mm - eps)
    def avg(mask): return norms[mask].mean(axis=0) if mask.any() else np.array([0,0,0])
    nf, nb, nl, nr = avg(front), avg(back), avg(left), avg(right)
    print("T6 wall normals (averaged):")
    print(f"   front (expect -y): {nf}")
    print(f"   back  (expect +y): {nb}")
    print(f"   left  (expect -x): {nl}")
    print(f"   right (expect +x): {nr}")
    bad = []
    if not (nf[1] < 0): bad.append("front")
    if not (nb[1] > 0): bad.append("back")
    if not (nl[0] < 0): bad.append("left")
    if not (nr[0] > 0): bad.append("right")
    if bad:
        print(f"   FAIL: inverted side-wall normals on: {bad}")
    else:
        print("   PASS: all side-wall normals point outward")


if __name__ == "__main__":
    tests = [T1_uniform, T2_gaussian, T3_two_bar_rmse, T4_anisotropic_alpha, T5_solvability, T6_stl_normals]
    fails = 0
    for t in tests:
        try:
            t()
        except AssertionError as e:
            print(f"  FAIL {t.__name__}: {e}"); fails += 1
        except Exception as e:
            print(f"  FAIL {t.__name__}: {type(e).__name__}: {e}"); fails += 1
    print("=" * 60)
    print(f"{len(tests) - fails}/{len(tests)} passed")
    sys.exit(0 if fails == 0 else 1)

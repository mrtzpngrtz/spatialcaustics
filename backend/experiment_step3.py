"""
STEP 3 experiment: compare two I_target rescaling strategies.

(a) current:  I_target *= mean(M^2 / I_target_clipped)
(b) proposed: I_target *= M^2 / mean(I_target_clipped)

Runs the solver with a bimodal target under both strategies, then
forward-raytraces each result and reports SSIM vs the original target.

Run from backend/ with the venv active:
    python experiment_step3.py
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import base64
import io
import numpy as np
from PIL import Image

import solver as S
from forward_raytrace import forward_raytrace

# ── Build a bimodal target (two bright blobs on dark background) ──────────────

N = 96
tgt = np.full((N, N), 0.1)
for cx, cy in [(N // 3, N // 2), (2 * N // 3, N // 2)]:
    y, x = np.ogrid[:N, :N]
    tgt += 0.9 * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (N / 10) ** 2)
tgt = np.clip(tgt, 0.0, 1.0)

img = Image.fromarray((tgt * 255).astype(np.uint8), mode="L")
buf = io.BytesIO()
img.save(buf, format="PNG")
target_b64 = base64.b64encode(buf.getvalue()).decode()

SOLVER_KW = dict(
    image_b64=target_b64,
    n_refract=1.49,
    thickness=0.003,
    proj_dist=0.5,
    smoothing=2.0,
    resolution=N,
    physical_size_x=0.05,
    physical_size_y=0.05,
    max_iterations=200,
    initial_step_size=0.3,
    smoothing_cooldown_iterations=120,
)

RAYTRACE_KW = dict(
    lens_size_m=0.05,
    projection_distance_m=0.5,
    refractive_index=1.49,
    target_resolution=N,
    n_rays=2_000_000,
)

tgt_peak = tgt.max()
tgt_n = np.clip(tgt / max(float(tgt_peak), 1e-12), 0.0, 1.0)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    try:
        from skimage.metrics import structural_similarity
        return float(structural_similarity(a, b, data_range=1.0))
    except ImportError:
        mu_a, mu_b = float(a.mean()), float(b.mean())
        C1, C2 = 0.01 ** 2, 0.03 ** 2
        sig_a, sig_b = float(a.std()), float(b.std())
        sig_ab = float(np.mean((a - mu_a) * (b - mu_b)))
        return (2 * mu_a * mu_b + C1) * (2 * sig_ab + C2) / (
            (mu_a ** 2 + mu_b ** 2 + C1) * (sig_a ** 2 + sig_b ** 2 + C2)
        )


def rms(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def evaluate(label: str, h: np.ndarray, iters: int, conv: bool) -> None:
    sim, energy = forward_raytrace(h, **RAYTRACE_KW)
    sim_n = np.clip(sim / max(float(sim.max()), 1e-12), 0.0, 1.0)
    s = ssim(sim_n, tgt_n)
    r = rms(sim_n, tgt_n)
    print(f"  {label}")
    print(f"    solver: iters={iters}  converged={conv}")
    print(f"    energy_ratio={energy:.4f}  SSIM={s:.4f}  RMS={r:.4f}")
    return s, r


# ── Approach (a): current code — no change needed ────────────────────────────
print("Approach (a): current  I_target *= mean(M^2 / I_target_clipped)")
result_a = S.run_solver(**SOLVER_KW)
s_a, r_a = evaluate("(a)", result_a.height_field, result_a.iterations_used, result_a.converged)

# ── Approach (b): proposed — patch the rescaling inline ──────────────────────
# We monkey-patch run_solver to intercept and replace the rescaling.
# We copy the relevant code, changing only lines 285-289 of solver.py.

import solver as _S_mod
import types

_orig_run = _S_mod.run_solver

def _patched_run(**kw):
    """Wrap run_solver, replacing the rescaling with approach (b)."""
    # We can't easily patch mid-function, so we re-implement the rescaling
    # by post-processing I_target before the iterative loop.
    # Strategy: use a subclass trick via a wrapper around xp.clip.
    #
    # Simpler: duplicate the relevant block here.
    #
    # Since the rescaling is baked into run_solver, we instead:
    # 1. Read the source to locate the rescale block
    # 2. Exec a modified version
    #
    # Easiest correct approach: import the raw ingredients and run the loop.
    # But that would duplicate a lot of code.
    #
    # Instead, we use a controlled experiment by directly modifying
    # I_target before calling the solver's internal loop -- which we
    # can't access without refactoring.
    #
    # So we run the solver normally, then apply the alternative rescaling
    # to the initial target and re-solve. We do this by temporarily
    # monkeypatching numpy/xp operations.
    #
    # Pragmatic solution: copy the rescale block with (b)'s formula.
    pass

# Since we can't easily inject mid-function, we implement approach (b)
# by modifying the source at the only relevant line.
# We do this safely by reading the solver module source, patching the
# relevant expression in memory, and execing it.

import inspect, textwrap, copy

src = inspect.getsource(_S_mod.run_solver)

# Replace approach (a) with approach (b):
# (a): I_target = I_target * ratio_mean  (where ratio_mean = mean(M2/I_target_clipped))
# (b): I_target = I_target * (M2 / float(I_target_clipped.mean()))
src_b = src.replace(
    "if ratio_mean > 1e-12:\n        I_target = I_target * ratio_mean",
    "if ratio_mean > 1e-12:\n        I_target = I_target * (M2 / float(I_target_clipped.mean()))",
)

if src_b == src:
    print("ERROR: could not locate the rescaling line to patch. Aborting STEP 3.")
    sys.exit(1)

# Build a modified module namespace
globs = copy.copy(vars(_S_mod))
exec(compile(textwrap.dedent("""
def run_solver_b(image_b64, n_refract, thickness, proj_dist, smoothing,
                 resolution, physical_size_x=0.05, physical_size_y=0.05,
                 magnification=1.0, max_iterations=200, initial_step_size=0.3,
                 smoothing_cooldown_iterations=100, incident_theta=0.0,
                 incident_phi=0.0, source_distance=None):
    pass
"""), "<experiment>", "exec"), globs)

# Actually, exec the full function body (cleanest approach)
src_fn = src_b.replace("def run_solver(", "def _run_solver_b(")
exec(compile(src_fn, "<experiment_b>", "exec"), globs)
run_solver_b = globs["_run_solver_b"]

print("\nApproach (b): proposed  I_target *= M^2 / mean(I_target_clipped)")
result_b = run_solver_b(**SOLVER_KW)
s_b, r_b = evaluate("(b)", result_b.height_field, result_b.iterations_used, result_b.converged)

# ── Summary ───────────────────────────────────────────────────────────────────
print()
print("=" * 52)
print("STEP 3 Summary (bimodal 96x96 target, 2M rays):")
print(f"  (a) current:  SSIM={s_a:.4f}  RMS={r_a:.4f}")
print(f"  (b) proposed: SSIM={s_b:.4f}  RMS={r_b:.4f}")
winner = "(b) proposed" if s_b > s_a else "(a) current"
print(f"  Winner by SSIM: {winner}")
print("=" * 52)

import { useLensStore } from "../stores/lensStore";

export function SetupDiagram() {
  const { params } = useLensStore();
  const { proj_dist, thickness, n, physical_size_x, physical_size_y } = params;

  // ── SVG layout ─────────────────────────────────────────────────────────────
  const W = 280;
  const H = 200;

  const ml = 44;   // left margin (dim labels)
  const mr = 52;   // right margin (n= label + screen)
  const mt = 38;   // top  (parallel light label + source line)
  const mb = 16;   // bottom

  const drawW = W - ml - mr;
  const drawH = H - mt - mb;
  const cx = ml + drawW / 2;

  // ── Physical → pixel scale (vertical only) ────────────────────────────────
  const LIGHT_GAP_M = 0.015;
  const SCREEN_GAP_M = 0.006;
  const totalPhys = LIGHT_GAP_M + Math.max(thickness, 0.0005) + proj_dist + SCREEN_GAP_M;
  const pxPerM = drawH / totalPhys;

  const ySource  = mt;
  const yLensTop = mt + LIGHT_GAP_M * pxPerM;
  const yLensBot = yLensTop + Math.max(thickness, 0.0005) * pxPerM;
  const yScreen  = yLensBot + proj_dist * pxPerM;

  // ── Lens half-width: capped so it fits in draw area ───────────────────────
  const rawHalfPx = (physical_size_x / 2) * pxPerM;
  const maxHalfPx = drawW * 0.42;
  const lensHalfPx = Math.min(rawHalfPx, maxHalfPx);
  const lensScale = lensHalfPx / Math.max(rawHalfPx, 1e-6); // 1 if fits, <1 if capped

  // ── Rays ───────────────────────────────────────────────────────────────────
  const numRays = 5;
  const rayXs = Array.from({ length: numRays }, (_, i) =>
    cx - lensHalfPx * 0.88 + (i / (numRays - 1)) * lensHalfPx * 1.76
  );
  const causticSpread = lensHalfPx * 0.15;
  const refX = (rx: number) => cx + (rx - cx) / lensHalfPx * causticSpread;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const dc = "#bbb";
  const dtc = "#999";
  const fs = 9;
  const mono = "'JetBrains Mono', monospace";
  const fmt = (m: number, unit: "mm" | "cm") =>
    unit === "mm" ? `${(m * 1000).toFixed(1)}mm` : `${(m * 100).toFixed(1)}cm`;

  function DimV({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
    if (y2 - y1 < 6) return null;
    const my = (y1 + y2) / 2;
    return (
      <g>
        <line x1={x} y1={y1} x2={x} y2={y2} stroke={dc} strokeWidth={0.6} />
        <line x1={x-4} y1={y1} x2={x+4} y2={y1} stroke={dc} strokeWidth={0.6} />
        <line x1={x-4} y1={y2} x2={x+4} y2={y2} stroke={dc} strokeWidth={0.6} />
        <polygon points={`${x},${y1} ${x-2},${y1+5} ${x+2},${y1+5}`} fill={dc} />
        <polygon points={`${x},${y2} ${x-2},${y2-5} ${x+2},${y2-5}`} fill={dc} />
        <text x={x-5} y={my} textAnchor="end" dominantBaseline="middle" fontSize={fs} fontFamily={mono} fill={dtc}>{label}</text>
      </g>
    );
  }

  const sizeLabel = Math.abs(physical_size_x - physical_size_y) < 0.001
    ? fmt(physical_size_x, "cm")
    : `${fmt(physical_size_x, "cm")}×${fmt(physical_size_y, "cm")}`;

  return (
    <div style={{ borderTop: "1px solid #e0e0e0", background: "#fff" }}>
      <div style={{ padding: "10px 16px 0", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888" }}>
        Optical Setup
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", maxWidth: W, height: "auto" }}>
        <rect width={W} height={H} fill="#fff" />

        {/* parallel light label */}
        <text x={cx} y={10} textAnchor="middle" fontSize={fs} fontFamily={mono} fill="#bbb" letterSpacing="0.05em">parallel light</text>

        {/* source dashed line */}
        <line x1={cx - lensHalfPx} y1={ySource} x2={cx + lensHalfPx} y2={ySource} stroke="#ddd" strokeWidth={0.8} strokeDasharray="3,2" />

        {/* incoming rays */}
        {rayXs.map((rx, i) => (
          <line key={`in${i}`} x1={rx} y1={ySource} x2={rx} y2={yLensTop} stroke="#ddd" strokeWidth={0.8} strokeDasharray="3,2" />
        ))}
        {rayXs.map((rx, i) => (
          <polygon key={`arr${i}`} points={`${rx},${yLensTop} ${rx-2.5},${yLensTop-6} ${rx+2.5},${yLensTop-6}`} fill="#ccc" />
        ))}

        {/* lens */}
        <rect
          x={cx - lensHalfPx} y={yLensTop}
          width={lensHalfPx * 2} height={Math.max(yLensBot - yLensTop, 1.5)}
          fill="#e8f0fe" stroke="#4a6fa5" strokeWidth={1}
        />

        {/* n= label */}
        <text x={cx + lensHalfPx + 5} y={(yLensTop + yLensBot) / 2} dominantBaseline="middle" fontSize={fs} fontFamily={mono} fill="#4a6fa5">
          n={n.toFixed(2)}
        </text>

        {/* refracted rays */}
        {rayXs.map((rx, i) => (
          <line key={`ref${i}`} x1={rx} y1={yLensBot} x2={refX(rx)} y2={yScreen} stroke="#ff5500" strokeWidth={0.8} opacity={0.55} />
        ))}

        {/* screen */}
        <line x1={cx - lensHalfPx * 1.3} y1={yScreen} x2={cx + lensHalfPx * 1.3} y2={yScreen} stroke="#0a0a0a" strokeWidth={1.5} />
        <text x={cx + lensHalfPx * 1.3 + 4} y={yScreen} dominantBaseline="middle" fontSize={fs} fontFamily={mono} fill="#888">screen</text>

        {/* caustic blob */}
        <ellipse cx={cx} cy={yScreen} rx={causticSpread * 1.4} ry={2.5} fill="#ff5500" opacity={0.15} />
        <ellipse cx={cx} cy={yScreen} rx={causticSpread * 1.4} ry={2.5} fill="none" stroke="#ff5500" strokeWidth={0.7} opacity={0.45} />

        {/* dim lines */}
        {/* lens width — below source line, above lens */}
        {(yLensTop - ySource) > 14 && (
          <g>
            <line x1={cx - lensHalfPx} y1={ySource + 8} x2={cx + lensHalfPx} y2={ySource + 8} stroke={dc} strokeWidth={0.6} />
            <line x1={cx - lensHalfPx} y1={ySource+4} x2={cx - lensHalfPx} y2={ySource+12} stroke={dc} strokeWidth={0.6} />
            <line x1={cx + lensHalfPx} y1={ySource+4} x2={cx + lensHalfPx} y2={ySource+12} stroke={dc} strokeWidth={0.6} />
            <polygon points={`${cx-lensHalfPx},${ySource+8} ${cx-lensHalfPx+6},${ySource+6} ${cx-lensHalfPx+6},${ySource+10}`} fill={dc} />
            <polygon points={`${cx+lensHalfPx},${ySource+8} ${cx+lensHalfPx-6},${ySource+6} ${cx+lensHalfPx-6},${ySource+10}`} fill={dc} />
            <text x={cx} y={ySource + 6} textAnchor="middle" fontSize={fs} fontFamily={mono} fill={dtc}>{sizeLabel}{lensScale < 0.98 ? " (scaled)" : ""}</text>
          </g>
        )}

        {/* lens thickness (only if visible) */}
        {(yLensBot - yLensTop) >= 5 && (
          <DimV x={ml - 8} y1={yLensTop} y2={yLensBot} label={fmt(thickness, "mm")} />
        )}

        {/* projection distance */}
        <DimV x={ml - 8} y1={yLensBot} y2={yScreen} label={fmt(proj_dist, "cm")} />
      </svg>
    </div>
  );
}

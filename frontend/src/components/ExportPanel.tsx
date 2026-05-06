import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLensStore } from "../stores/lensStore";
import type { MoldParams } from "../stores/lensStore";
import type { ExportSTLRequest } from "../types/api";

async function postExportSTL(req: ExportSTLRequest, filename: string): Promise<void> {
  const res = await fetch("/api/export-stl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(detail.detail ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function postExportContainer(body: object, filename: string): Promise<void> {
  const res = await fetch("/api/export-container", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(detail.detail ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function buildFilename(projectName: string | null, kind: string, tags: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = projectName
    ? projectName.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40)
    : "caustic";
  return `${base}_${kind}_${tags}_${date}_${time}.stl`;
}

const mono = "'JetBrains Mono', monospace";

const css: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    background: "#fff",
    width: "min(700px, 96vw)",
    maxHeight: "92vh",
    overflowY: "auto",
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 24px",
    borderBottom: "1px solid #e8e8e8",
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#0a0a0a",
    fontFamily: mono,
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 16,
    color: "#aaa",
    padding: 0,
    lineHeight: 1,
  },
  // Lens + Holder: side-by-side columns
  twoColSection: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    borderBottom: "1px solid #e8e8e8",
  },
  lensCol: {
    padding: "20px 24px 24px",
    borderRight: "1px solid #e8e8e8",
    display: "flex",
    flexDirection: "column" as const,
  },
  holderCol: {
    padding: "20px 24px 24px",
    display: "flex",
    flexDirection: "column" as const,
  },
  // Mold: full-width section
  moldSection: {
    padding: "20px 24px 24px",
  },
  moldParamGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0 24px",
  },
  colLabel: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#999",
    fontFamily: mono,
    display: "block",
    marginBottom: 18,
  },
  row: { marginBottom: 20 },
  rowLabel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 7,
  } as React.CSSProperties,
  name: {
    fontSize: 12,
    color: "#333",
    fontFamily: mono,
  },
  numInput: {
    fontFamily: mono,
    fontSize: 12,
    color: "#ff5500",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #ddd",
    outline: "none",
    width: 60,
    textAlign: "right" as const,
    padding: "1px 2px",
  },
  unit: {
    fontSize: 11,
    color: "#aaa",
    fontFamily: mono,
    marginLeft: 2,
  },
  slider: {
    width: "100%",
    appearance: "none" as const,
    WebkitAppearance: "none",
    height: 2,
    background: "#e0e0e0",
    outline: "none",
    cursor: "pointer",
  },
  btnPrimary: {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    border: "1px solid #0a0a0a",
    background: "#0a0a0a",
    color: "#f8f8f6",
    padding: "10px 20px",
    cursor: "pointer",
    outline: "none",
    borderRadius: 0,
    width: "100%",
    marginTop: "auto",
  },
  btnSecondary: {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    border: "1px solid #ccc",
    background: "transparent",
    color: "#333",
    padding: "9px 20px",
    cursor: "pointer",
    outline: "none",
    borderRadius: 0,
    width: "100%",
    marginTop: "auto",
  },
  btnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  errorMsg: {
    fontSize: 11,
    color: "#ff5500",
    fontFamily: mono,
  },
  savedNote: {
    fontSize: 10,
    color: "#bbb",
    fontFamily: mono,
    letterSpacing: "0.06em",
    textAlign: "right" as const,
    display: "block",
    marginTop: -14,
    marginBottom: 14,
  },
  infoLine: {
    fontSize: 10,
    color: "#999",
    fontFamily: mono,
    lineHeight: 1.6,
    marginBottom: 16,
  },
};

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={css.row}>
      <div style={css.rowLabel}>
        <span style={css.name}>{label}</span>
        <span style={{ display: "flex", alignItems: "baseline" }}>
          <input
            type="number" min={min} max={max} step={step} value={value}
            onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={css.numInput}
          />
          <span style={css.unit}>{unit}</span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={css.slider}
      />
    </div>
  );
}

function MoldRow({ label, paramKey, min, max, step, unit, scale = 1, decimals = 2 }: {
  label: string; paramKey: keyof MoldParams;
  min: number; max: number; step: number; unit: string; scale?: number; decimals?: number;
}) {
  const { moldParams, setMoldParam } = useLensStore();
  const raw = moldParams[paramKey] as number;
  const displayed = raw * scale;
  const [editVal, setEditVal] = useState<string | null>(null);

  const commit = (str: string) => {
    const v = parseFloat(str);
    if (!isNaN(v)) setMoldParam(paramKey, Math.min(max, Math.max(min, v / scale)));
    setEditVal(null);
  };

  return (
    <div style={css.row}>
      <div style={css.rowLabel}>
        <span style={css.name}>{label}</span>
        <span style={{ display: "flex", alignItems: "baseline" }}>
          <input
            type="number"
            min={min * scale} max={max * scale} step={step * scale}
            value={editVal ?? displayed.toFixed(decimals)}
            onChange={(e) => setEditVal(e.target.value)}
            onFocus={() => setEditVal(displayed.toFixed(decimals))}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={css.numInput}
          />
          {unit && <span style={css.unit}>{unit}</span>}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={raw}
        onChange={(e) => setMoldParam(paramKey, parseFloat(e.target.value))}
        style={css.slider}
      />
    </div>
  );
}

interface ExportPanelProps { onClose: () => void; }

function calcEpoxyMl(hf: number[][], thickness: number, sizeX: number, sizeY: number): number {
  const rows = hf.length;
  const cols = hf[0]?.length ?? 0;
  if (!rows || !cols) return 0;
  const pixelArea = (sizeX / cols) * (sizeY / rows);
  let vol = 0;
  for (const row of hf) for (const v of row) vol += (thickness - v) * pixelArea;
  return vol * 1e6;
}

function calcSiliconeMl(
  hf: number[][],
  sizeX: number, sizeY: number,
  thickness: number, baseThickness: number,
  clearanceM: number, extraWallM: number,
): number {
  const rows = hf.length;
  const cols = hf[0]?.length ?? 0;
  if (!rows || !cols) return 0;
  const pixelArea = (sizeX / cols) * (sizeY / rows);
  let lensVol = 0;
  for (const row of hf) for (const v of row) lensVol += (v + baseThickness) * pixelArea;
  // pocket depth = lens thickness + extra wall above lens
  const lt = thickness + baseThickness + extraWallM;
  const pocketVol = (sizeX + 2 * clearanceM) * (sizeY + 2 * clearanceM) * lt;
  return Math.max(0, pocketVol - lensVol) * 1e6;
}

export function ExportPanel({ onClose }: ExportPanelProps) {
  const { computeResult, params, moldParams, currentProjectName } = useLensStore();
  const canExport = computeResult !== null;

  const [biconvex, setBiconvex] = useState(false);
  const [baseCurveMm, setBaseCurveMm] = useState(200);
  const [containerWallMm, setContainerWallMm] = useState(3);
  const [bottomHeightMm, setBottomHeightMm] = useState(2);
  const [clearanceMm, setClearanceMm] = useState(0.3);
  const [extraWallMm, setExtraWallMm] = useState(0);

  const epoxyMl = computeResult
    ? calcEpoxyMl(computeResult.height_field, params.thickness, params.physical_size_x, params.physical_size_y)
    : 0;
  const lensThicknessMm = params.thickness * 1000 + params.base_thickness * 1000;
  const siliconeMl = computeResult
    ? calcSiliconeMl(
        computeResult.height_field,
        params.physical_size_x, params.physical_size_y,
        params.thickness, params.base_thickness,
        clearanceMm / 1000, extraWallMm / 1000,
      )
    : null;

  const buildLensReq = (negative: boolean): ExportSTLRequest => ({
    height_field: computeResult!.height_field,
    thickness: params.thickness,
    base_thickness: params.base_thickness,
    physical_size_x: params.physical_size_x,
    physical_size_y: params.physical_size_y,
    negative,
    border_height: moldParams.border_height,
    wall_thickness: moldParams.wall_thickness,
    base_curve_radius: !negative && biconvex ? baseCurveMm / 1000 : null,
  });

  const sx = (params.physical_size_x * 1000).toFixed(0);
  const sy = (params.physical_size_y * 1000).toFixed(0);
  const size = `${sx}x${sy}mm`;

  const effectiveL  = computeResult?.effective_proj_dist ?? params.proj_dist;
  const lensTags    = `${size}_n${params.n.toFixed(2)}_d${(params.thickness * 1000).toFixed(1)}mm_b${(params.base_thickness * 1000).toFixed(1)}mm_L${(effectiveL * 1000).toFixed(0)}mm`;
  const moldTags    = `${size}_${epoxyMl.toFixed(2)}ml_bh${(moldParams.border_height * 1000).toFixed(1)}mm`;
  const holderTags  = `${size}_w${containerWallMm}mm_cl${clearanceMm}mm_${siliconeMl !== null ? siliconeMl.toFixed(2) + "ml" : "nocompute"}`;

  const lensMutation     = useMutation({ mutationFn: () => postExportSTL(buildLensReq(false), buildFilename(currentProjectName, "lens",   lensTags)) });
  const moldMutation     = useMutation({ mutationFn: () => postExportSTL(buildLensReq(true),  buildFilename(currentProjectName, "mold",   moldTags)) });
  const containerMutation = useMutation({
    mutationFn: () => postExportContainer({
      physical_size_x:      params.physical_size_x,
      physical_size_y:      params.physical_size_y,
      lens_total_thickness: lensThicknessMm / 1000,
      wall_thickness:       containerWallMm / 1000,
      bottom_height:        bottomHeightMm  / 1000,
      clearance:            clearanceMm     / 1000,
      extra_wall_height:    extraWallMm     / 1000,
    }, buildFilename(currentProjectName, "holder", holderTags)),
  });

  const error = (lensMutation.error as Error | null)?.message
    ?? (moldMutation.error as Error | null)?.message
    ?? (containerMutation.error as Error | null)?.message ?? null;

  return (
    <div style={css.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`
        .export-panel input[type=number]::-webkit-inner-spin-button,
        .export-panel input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .export-panel input[type=number] { -moz-appearance: textfield; }
        .export-panel input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 13px; height: 13px;
          border-radius: 50%; background: #0a0a0a; cursor: pointer;
        }
        .export-panel input[type=range]:hover::-webkit-slider-thumb { background: #ff5500; }
        .export-panel input[type=range]::-moz-range-thumb {
          width: 13px; height: 13px; border-radius: 50%;
          background: #0a0a0a; cursor: pointer; border: none;
        }
      `}</style>
      <div style={css.panel} className="export-panel">

        {/* Header */}
        <div style={css.header}>
          <span style={css.headerTitle}>Export</span>
          <button style={css.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* ── Lens | Holder (two columns) ── */}
        <div style={css.twoColSection}>

          {/* Left: Lens */}
          <div style={css.lensCol}>
            <span style={css.colLabel}>Lens</span>
            <table style={{ fontFamily: mono, fontSize: 11, borderCollapse: "collapse", marginBottom: 18, width: "100%" }}>
              <tbody>
                {[
                  ["size",  `${(params.physical_size_x * 1000).toFixed(0)} × ${(params.physical_size_y * 1000).toFixed(0)} mm`],
                  ["thickness", `${(params.thickness * 1000).toFixed(1)} mm`],
                  ["base", `${(params.base_thickness * 1000).toFixed(1)} mm`],
                  ["n", params.n.toFixed(3)],
                  ["resolution", `${params.resolution} px`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: "#bbb", paddingRight: 12, paddingBottom: 5 }}>{k}</td>
                    <td style={{ color: "#333", paddingBottom: 5 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 18 }}>
              <input
                type="checkbox" checked={biconvex}
                onChange={(e) => setBiconvex(e.target.checked)}
                style={{ accentColor: "#ff5500" }}
              />
              <span style={{ ...css.name, fontSize: 11 }}>biconvex base</span>
            </label>
            {biconvex && (
              <SliderRow
                label="base radius" value={baseCurveMm}
                min={50} max={500} step={10} unit="mm"
                onChange={setBaseCurveMm}
              />
            )}
            <button
              style={{ ...css.btnPrimary, ...(canExport && !lensMutation.isPending ? {} : css.btnDisabled) }}
              disabled={!canExport || lensMutation.isPending}
              onClick={() => lensMutation.mutate()}
            >
              {lensMutation.isPending ? "exporting…" : "↓ Export Lens STL"}
            </button>
          </div>

          {/* Right: Holder */}
          <div style={css.holderCol}>
            <span style={css.colLabel}>Holder</span>
            {canExport && (
              <div style={{ ...css.infoLine, marginBottom: 18 }}>
                <div>pocket depth: <span style={{ color: "#ff5500" }}>{lensThicknessMm.toFixed(1)} mm</span></div>
                {siliconeMl !== null && (
                  <div>silicone: <span style={{ color: "#ff5500" }}>{siliconeMl.toFixed(3)} ml</span>
                    <span style={{ color: "#ccc", marginLeft: 6 }}>→ {(siliconeMl * 1.1).toFixed(2)} ml +10%</span>
                  </div>
                )}
              </div>
            )}
            <SliderRow label="wall thickness"  value={containerWallMm} min={0.5} max={50} step={0.5}  unit="mm" onChange={setContainerWallMm} />
            <SliderRow label="bottom height"   value={bottomHeightMm}  min={0.5} max={10} step={0.5}  unit="mm" onChange={setBottomHeightMm} />
            <SliderRow label="clearance"       value={clearanceMm}     min={0}   max={50} step={0.1}  unit="mm" onChange={setClearanceMm} />
            <SliderRow label="wall above lens" value={extraWallMm}     min={0}   max={50} step={0.5}  unit="mm" onChange={setExtraWallMm} />
            <button
              style={{ ...css.btnSecondary, ...(!containerMutation.isPending ? {} : css.btnDisabled) }}
              disabled={containerMutation.isPending}
              onClick={() => containerMutation.mutate()}
            >
              {containerMutation.isPending ? "exporting…" : "↓ Export Holder STL"}
            </button>
          </div>
        </div>

        {/* ── Mold (full width) ── */}
        <div style={css.moldSection}>
          <span style={css.colLabel}>Mold</span>
          <span style={css.savedNote}>settings auto-saved</span>
          <div style={css.moldParamGrid}>
            <MoldRow label="border height"  paramKey="border_height"  min={0} max={0.02} step={0.0001} unit="mm" scale={1000} decimals={2} />
            <MoldRow label="wall thickness" paramKey="wall_thickness" min={0.0001} max={0.02} step={0.0001} unit="mm" scale={1000} decimals={2} />
          </div>
          {canExport && (
            <div style={{ ...css.infoLine, marginTop: -4 }}>
              epoxy: <span style={{ color: "#ff5500" }}>{epoxyMl.toFixed(3)} ml</span>
              <span style={{ color: "#ccc", marginLeft: 8 }}>→ {(epoxyMl * 1.1).toFixed(2)} ml with +10% waste</span>
            </div>
          )}
          <button
            style={{ ...css.btnPrimary, marginTop: 4, ...(canExport && !moldMutation.isPending ? {} : css.btnDisabled) }}
            disabled={!canExport || moldMutation.isPending}
            onClick={() => moldMutation.mutate()}
          >
            {moldMutation.isPending ? "exporting…" : "↓ Export Mold STL"}
          </button>
        </div>

        {error && (
          <div style={{ padding: "12px 24px", borderTop: "1px solid #f0f0f0" }}>
            <span style={css.errorMsg}>{error}</span>
          </div>
        )}
        {!canExport && (
          <div style={{ padding: "12px 24px", borderTop: "1px solid #f0f0f0" }}>
            <span style={{ ...css.errorMsg, color: "#bbb" }}>run compute first</span>
          </div>
        )}
      </div>
    </div>
  );
}

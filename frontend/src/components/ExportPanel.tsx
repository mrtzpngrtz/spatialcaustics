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
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildFilename(
  projectName: string | null,
  mold: boolean,
  params: { n: number; thickness: number; resolution: number },
  moldParams: { border_height: number; wall_thickness: number },
  epoxyMl?: number,
): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const kind = mold ? "mold" : "lens";
  const base = projectName
    ? projectName.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40)
    : "caustic";
  const settings = mold
    ? `_bh${(moldParams.border_height * 1000).toFixed(1)}mm_wt${(moldParams.wall_thickness * 1000).toFixed(1)}mm_${epoxyMl?.toFixed(2)}ml`
    : `_n${params.n.toFixed(2)}_d${(params.thickness * 1000).toFixed(1)}mm_${params.resolution}px`;
  return `${base}_${kind}${settings}_${date}_${time}.stl`;
}

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
    width: 360,
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 20px",
    borderBottom: "1px solid #e8e8e8",
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#0a0a0a",
    fontFamily: "'JetBrains Mono', monospace",
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
  section: {
    padding: "16px 20px 20px",
    borderBottom: "1px solid #e8e8e8",
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#999",
    fontFamily: "'JetBrains Mono', monospace",
    display: "block",
    marginBottom: 16,
  },
  row: { marginBottom: 18 },
  rowLabel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
  } as React.CSSProperties,
  name: {
    fontSize: 12,
    color: "#333",
    fontFamily: "'JetBrains Mono', monospace",
  },
  numInput: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: "#ff5500",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #ddd",
    outline: "none",
    width: 68,
    textAlign: "right" as const,
    padding: "1px 2px",
  },
  unit: {
    fontSize: 11,
    color: "#aaa",
    fontFamily: "'JetBrains Mono', monospace",
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
  exportBtn: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    border: "1px solid #0a0a0a",
    background: "#0a0a0a",
    color: "#f8f8f6",
    padding: "9px 20px",
    cursor: "pointer",
    outline: "none",
    borderRadius: 0,
    width: "100%",
    marginTop: 4,
  },
  exportBtnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  errorMsg: {
    fontSize: 11,
    color: "#ff5500",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: 8,
  },
  savedNote: {
    fontSize: 10,
    color: "#bbb",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.06em",
    textAlign: "right" as const,
    display: "block",
    marginTop: -12,
    marginBottom: 12,
  },
};

function MoldRow({ label, paramKey, min, max, step, unit, scale = 1, decimals = 2 }: {
  label: string;
  paramKey: keyof MoldParams;
  min: number; max: number; step: number;
  unit: string; scale?: number; decimals?: number;
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

interface ExportPanelProps {
  onClose: () => void;
}

function calcEpoxyMl(hf: number[][], thickness: number, sizeX: number, sizeY: number): number {
  const rows = hf.length;
  const cols = hf[0]?.length ?? 0;
  if (!rows || !cols) return 0;
  const pixelArea = (sizeX / cols) * (sizeY / rows);
  let vol = 0;
  for (const row of hf) for (const v of row) vol += (thickness - v) * pixelArea;
  return vol * 1e6; // m³ → ml
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

export function ExportPanel({ onClose }: ExportPanelProps) {
  const { computeResult, params, moldParams, currentProjectName } = useLensStore();
  const canExport = computeResult !== null;
  const [biconvex, setBiconvex] = useState(false);
  const [baseCurveMm, setBaseCurveMm] = useState(200);
  const [containerWallMm, setContainerWallMm] = useState(3);
  const [bottomHeightMm, setBottomHeightMm] = useState(2);
  const [clearanceMm, setClearanceMm] = useState(0.3);

  const epoxyMl = computeResult
    ? calcEpoxyMl(computeResult.height_field, params.thickness, params.physical_size_x, params.physical_size_y)
    : 0;

  const buildReq = (negative: boolean): ExportSTLRequest => ({
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

  const lensMutation = useMutation({
    mutationFn: () => postExportSTL(buildReq(false), buildFilename(currentProjectName, false, params, moldParams)),
  });
  const moldMutation = useMutation({
    mutationFn: () => postExportSTL(buildReq(true), buildFilename(currentProjectName, true, params, moldParams, epoxyMl)),
  });

  const lensThicknessMm = params.thickness * 1000 + params.base_thickness * 1000;
  const containerMutation = useMutation({
    mutationFn: () => postExportContainer({
      physical_size_x: params.physical_size_x,
      physical_size_y: params.physical_size_y,
      lens_total_thickness: lensThicknessMm / 1000,
      wall_thickness: containerWallMm / 1000,
      bottom_height: bottomHeightMm / 1000,
      clearance: clearanceMm / 1000,
    }, `${currentProjectName ?? "caustic"}_holder_${containerWallMm}mmwall.stl`),
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
          -webkit-appearance: none; width: 14px; height: 14px;
          border-radius: 50%; background: #0a0a0a; cursor: pointer;
        }
        .export-panel input[type=range]:hover::-webkit-slider-thumb { background: #ff5500; }
        .export-panel input[type=range]::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: #0a0a0a; cursor: pointer; border: none;
        }
      `}</style>
      <div style={css.panel} className="export-panel">
        <div style={css.header}>
          <span style={css.headerTitle}>Export</span>
          <button style={css.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Lens STL */}
        <div style={css.section}>
          <span style={css.sectionLabel}>Lens STL</span>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={biconvex}
                onChange={(e) => setBiconvex(e.target.checked)}
                style={{ accentColor: "#ff5500" }}
              />
              <span style={{ ...css.name, fontSize: 11 }}>biconvex (curved both sides)</span>
            </label>
            {biconvex && (
              <div style={css.row}>
                <div style={css.rowLabel}>
                  <span style={css.name}>base radius</span>
                  <span style={{ display: "flex", alignItems: "baseline" }}>
                    <input
                      type="number"
                      min={50} max={1000} step={10}
                      value={baseCurveMm}
                      onChange={(e) => setBaseCurveMm(Math.max(50, Math.min(1000, parseFloat(e.target.value) || 200)))}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      style={css.numInput}
                    />
                    <span style={css.unit}>mm</span>
                  </span>
                </div>
                <input
                  type="range" min={50} max={500} step={10}
                  value={Math.min(baseCurveMm, 500)}
                  onChange={(e) => setBaseCurveMm(parseFloat(e.target.value))}
                  style={css.slider}
                />
                <div style={{ fontSize: 10, color: "#bbb", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
                  larger radius = flatter bottom
                </div>
              </div>
            )}
          </div>
          <button
            style={{ ...css.exportBtn, ...(canExport && !lensMutation.isPending ? {} : css.exportBtnDisabled) }}
            disabled={!canExport || lensMutation.isPending}
            onClick={() => lensMutation.mutate()}
          >
            {lensMutation.isPending ? "exporting…" : "↓ Export Lens STL"}
          </button>
        </div>

        {/* Mold STL */}
        <div style={css.section}>
          <span style={css.sectionLabel}>Mold STL</span>
          <span style={css.savedNote}>settings auto-saved</span>
          <MoldRow label="border height" paramKey="border_height" min={0} max={0.02} step={0.0001} unit="mm" scale={1000} decimals={2} />
          <MoldRow label="wall thickness" paramKey="wall_thickness" min={0.0001} max={0.02} step={0.0001} unit="mm" scale={1000} decimals={2} />
          {canExport && (
            <div style={{ marginBottom: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#555" }}>
              epoxy needed: <span style={{ color: "#ff5500" }}>{epoxyMl.toFixed(3)} ml</span>
              <span style={{ color: "#bbb", marginLeft: 6 }}>(+10% waste → {(epoxyMl * 1.1).toFixed(2)} ml)</span>
            </div>
          )}
          <button
            style={{ ...css.exportBtn, ...(canExport && !moldMutation.isPending ? {} : css.exportBtnDisabled) }}
            disabled={!canExport || moldMutation.isPending}
            onClick={() => moldMutation.mutate()}
          >
            {moldMutation.isPending ? "exporting…" : "↓ Export Mold STL"}
          </button>
        </div>

        {/* Container / Holder STL */}
        <div style={css.section}>
          <span style={css.sectionLabel}>Lens Holder STL</span>
          <div style={{ marginBottom: 10, fontSize: 10, color: "#888", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>
            Separate container the finished lens sits in.
            {canExport && <> Pocket depth: <span style={{ color: "#ff5500" }}>{lensThicknessMm.toFixed(1)}mm</span>.</>}
          </div>
          <div style={css.row}>
            <div style={css.rowLabel}>
              <span style={css.name}>wall thickness</span>
              <span style={{ display: "flex", alignItems: "baseline" }}>
                <input type="number" min={1} max={10} step={0.5} value={containerWallMm}
                  onChange={(e) => setContainerWallMm(parseFloat(e.target.value) || 3)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  style={css.numInput} />
                <span style={css.unit}>mm</span>
              </span>
            </div>
            <input type="range" min={1} max={10} step={0.5} value={containerWallMm}
              onChange={(e) => setContainerWallMm(parseFloat(e.target.value))} style={css.slider} />
          </div>
          <div style={css.row}>
            <div style={css.rowLabel}>
              <span style={css.name}>bottom height</span>
              <span style={{ display: "flex", alignItems: "baseline" }}>
                <input type="number" min={0.5} max={10} step={0.5} value={bottomHeightMm}
                  onChange={(e) => setBottomHeightMm(parseFloat(e.target.value) || 2)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  style={css.numInput} />
                <span style={css.unit}>mm</span>
              </span>
            </div>
            <input type="range" min={0.5} max={10} step={0.5} value={bottomHeightMm}
              onChange={(e) => setBottomHeightMm(parseFloat(e.target.value))} style={css.slider} />
          </div>
          <div style={css.row}>
            <div style={css.rowLabel}>
              <span style={css.name}>clearance gap</span>
              <span style={{ display: "flex", alignItems: "baseline" }}>
                <input type="number" min={0} max={20} step={0.1} value={clearanceMm}
                  onChange={(e) => setClearanceMm(parseFloat(e.target.value) || 0.3)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  style={css.numInput} />
                <span style={css.unit}>mm</span>
              </span>
            </div>
            <input type="range" min={0} max={20} step={0.1} value={clearanceMm}
              onChange={(e) => setClearanceMm(parseFloat(e.target.value))} style={css.slider} />
          </div>
          <button
            style={{ ...css.exportBtn, ...(!containerMutation.isPending ? {} : css.exportBtnDisabled) }}
            disabled={containerMutation.isPending}
            onClick={() => containerMutation.mutate()}
          >
            {containerMutation.isPending ? "exporting…" : "↓ Export Holder STL"}
          </button>
        </div>

        {error && <div style={{ padding: "12px 20px" }}><span style={css.errorMsg}>{error}</span></div>}
        {!canExport && (
          <div style={{ padding: "12px 20px" }}>
            <span style={{ ...css.errorMsg, color: "#bbb" }}>run compute first</span>
          </div>
        )}
      </div>
    </div>
  );
}

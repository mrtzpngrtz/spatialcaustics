import { useState, useRef } from "react";
import { useLensStore } from "../stores/lensStore";
import type { LensParams } from "../types/api";

// ── Shared section header ──────────────────────────────────────────────────────

function Section({ label, children, defaultOpen = true }: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #e8e8e8" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "9px 20px",
          cursor: "pointer",
          userSelect: "none",
          background: "#fafafa",
        }}
      >
        <span style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: "#999",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 9,
          color: "#bbb",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 0.15s",
          display: "inline-block",
        }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: "16px 20px 20px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Slider row (lens params) ───────────────────────────────────────────────────

const rowCss = {
  row: { marginBottom: 18 } as React.CSSProperties,
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
  } as React.CSSProperties,
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
  } as React.CSSProperties,
  unit: {
    fontSize: 11,
    color: "#aaa",
    fontFamily: "'JetBrains Mono', monospace",
    marginLeft: 2,
  } as React.CSSProperties,
  slider: {
    width: "100%",
    appearance: "none" as const,
    WebkitAppearance: "none",
    height: 2,
    background: "#e0e0e0",
    outline: "none",
    cursor: "pointer",
  } as React.CSSProperties,
  selectRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,
  select: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    border: "1px solid #e0e0e0",
    borderRadius: 0,
    padding: "4px 8px",
    background: "#fff",
    color: "#0a0a0a",
    cursor: "pointer",
    outline: "none",
  } as React.CSSProperties,
};

function SliderRow({ label, paramKey, min, max, step, unit, scale = 1, decimals = 2 }: {
  label: string;
  paramKey: keyof LensParams;
  min: number;
  max: number;
  step: number;
  unit: string;
  scale?: number;
  decimals?: number;
}) {
  const { params, setParam } = useLensStore();
  const raw = params[paramKey] as number;
  const displayed = raw * scale;
  const [editVal, setEditVal] = useState<string | null>(null);

  const commit = (str: string) => {
    const v = parseFloat(str);
    if (!isNaN(v)) {
      const clamped = Math.min(max, Math.max(min, v / scale));
      setParam(paramKey, clamped as LensParams[typeof paramKey]);
    }
    setEditVal(null);
  };

  return (
    <div style={rowCss.row}>
      <div style={rowCss.rowLabel}>
        <span style={rowCss.name}>{label}</span>
        <span style={{ display: "flex", alignItems: "baseline" }}>
          <input
            type="number"
            min={min * scale} max={max * scale} step={step * scale}
            value={editVal ?? displayed.toFixed(decimals)}
            onChange={(e) => setEditVal(e.target.value)}
            onFocus={() => setEditVal(displayed.toFixed(decimals))}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={rowCss.numInput}
          />
          {unit && <span style={rowCss.unit}>{unit}</span>}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={raw}
        onChange={(e) => setParam(paramKey, parseFloat(e.target.value) as LensParams[typeof paramKey])}
        style={rowCss.slider}
      />
    </div>
  );
}

// ── Light direction picker ─────────────────────────────────────────────────────

const SIZE = 150;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 60;

function LightDirPicker() {
  const { params, setParam } = useLensStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const theta = params.incident_theta;
  const phi = params.incident_phi;
  const dotR = (theta / 90) * R;
  const phiRad = (phi * Math.PI) / 180;
  const dotX = CX + dotR * Math.sin(phiRad);
  const dotY = CY - dotR * Math.cos(phiRad);

  const update = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((clientX - rect.left) / rect.width) * SIZE - CX;
    const dy = -(((clientY - rect.top) / rect.height) * SIZE - CY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    setParam("incident_theta", Math.min(85, Math.round((dist / R) * 90 * 10) / 10));
    setParam("incident_phi", dist < 1 ? 0 : Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360));
  };

  const active = theta > 0.5;

  return (
    <div style={{ padding: "16px 0 4px" }}>
      <div style={{
        fontSize: 10, fontWeight: 500, letterSpacing: "0.1em",
        textTransform: "uppercase" as const, color: "#bbb",
        fontFamily: "'JetBrains Mono', monospace", marginBottom: 12,
      }}>
        Light direction
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <svg
          ref={svgRef}
          width={SIZE} height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ cursor: "crosshair", flexShrink: 0, borderRadius: "50%" }}
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); update(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (dragging.current) update(e.clientX, e.clientY); }}
          onPointerUp={() => { dragging.current = false; }}
        >
          <circle cx={CX} cy={CY} r={R + 1} fill="#0e0e0e" />
          <circle cx={CX} cy={CY} r={R * (30 / 90)} fill="none" stroke="#222" strokeWidth={0.5} />
          <circle cx={CX} cy={CY} r={R * (60 / 90)} fill="none" stroke="#222" strokeWidth={0.5} />
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#2a2a2a" strokeWidth={1} />
          <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke="#1e1e1e" strokeWidth={0.5} />
          <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke="#1e1e1e" strokeWidth={0.5} />
          {["N","E","S","W"].map((l, i) => {
            const a = i * 90 * Math.PI / 180;
            return <text key={l} x={CX + (R + 6) * Math.sin(a)} y={CY - (R + 6) * Math.cos(a) + 3}
              textAnchor="middle" fontSize={6} fill="#333" fontFamily="monospace">{l}</text>;
          })}
          {active && <line x1={CX} y1={CY} x2={dotX} y2={dotY} stroke="#ff5500" strokeWidth={0.5} strokeOpacity={0.35} />}
          <circle cx={dotX} cy={dotY} r={6} fill={active ? "#ff5500" : "#333"} fillOpacity={0.9} />
          {active && [0,45,90,135,180,225,270,315].map(a => {
            const ar = a * Math.PI / 180;
            return <line key={a} x1={dotX + 7 * Math.cos(ar)} y1={dotY + 7 * Math.sin(ar)}
              x2={dotX + 10 * Math.cos(ar)} y2={dotY + 10 * Math.sin(ar)}
              stroke="#ff5500" strokeWidth={1} strokeOpacity={0.5} />;
          })}
          <circle cx={CX} cy={CY} r={2.5} fill="#1a1a1a" stroke="#333" strokeWidth={0.5} />
        </svg>

        <div style={{ fontFamily: "'JetBrains Mono', monospace", paddingTop: 6 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: "#555", marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>elev</div>
            <div style={{ fontSize: 15, color: active ? "#ff5500" : "#444" }}>{theta.toFixed(1)}°</div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: "#555", marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>az</div>
            <div style={{ fontSize: 15, color: active ? "#ff5500" : "#444" }}>{phi.toFixed(0)}°</div>
          </div>
          <div style={{ fontSize: 9, color: active ? "#666" : "#333", lineHeight: 1.5, marginBottom: 10 }}>
            {active ? (() => {
              const shiftCm = (params.proj_dist * Math.tan(theta * Math.PI / 180) * 100);
              return <>shift<br /><span style={{ color: "#ff5500" }}>{shiftCm.toFixed(1)}cm</span><br />on wall</>;
            })() : <>center = vertical<br />drag to tilt</>}
          </div>
          {active && (
            <button
              onClick={() => { setParam("incident_theta", 0); setParam("incident_phi", 0); }}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                border: "1px solid #333",
                background: "transparent",
                color: "#666",
                padding: "3px 7px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Spotlight / collimated toggle ─────────────────────────────────────────────

function SpotlightControl() {
  const { params, setParam } = useLensStore();
  const isSpot = params.source_distance !== null;
  const distM = params.source_distance ?? 0.5;

  return (
    <div style={{ paddingTop: 16, borderTop: "1px solid #f0f0f0", marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isSpot ? 12 : 0 }}>
        <span style={{ ...rowCss.name, color: isSpot ? "#0a0a0a" : "#bbb" }}>spotlight</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <span style={{ fontSize: 10, color: "#aaa", fontFamily: "'JetBrains Mono', monospace" }}>
            {isSpot ? "point src" : "collimated"}
          </span>
          <input
            type="checkbox"
            checked={isSpot}
            onChange={(e) => setParam("source_distance", e.target.checked ? 0.5 : null)}
            style={{ cursor: "pointer", accentColor: "#ff5500" }}
          />
        </label>
      </div>
      {isSpot && (
        <div style={rowCss.row}>
          <div style={rowCss.rowLabel}>
            <span style={rowCss.name}>source dist</span>
            <span style={{ display: "flex", alignItems: "baseline" }}>
              <input
                type="number"
                min={5} max={500} step={1}
                value={(distM * 100).toFixed(0)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setParam("source_distance", Math.min(5, Math.max(0.05, v / 100)));
                }}
                style={rowCss.numInput}
              />
              <span style={rowCss.unit}>cm</span>
            </span>
          </div>
          <input
            type="range" min={0.05} max={5} step={0.05}
            value={distM}
            onChange={(e) => setParam("source_distance", parseFloat(e.target.value))}
            style={rowCss.slider}
          />
          <div style={{ fontSize: 9, color: "#888", fontFamily: "'JetBrains Mono', monospace", marginTop: 5 }}>
            L_eff = {((params.proj_dist * distM) / (params.proj_dist + distM) * 100).toFixed(1)} cm
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ParamPanel() {
  const { params, setParam, targetImageSize } = useLensStore();
  const resOptions = [32, 64, 128, 256, 512, 1024, 2048];

  const applyImageRatio = () => {
    if (!targetImageSize) return;
    const { w, h } = targetImageSize;
    const ratio = w / h;
    const cur = Math.max(params.physical_size_x, params.physical_size_y);
    if (ratio >= 1) {
      setParam("physical_size_x", cur);
      setParam("physical_size_y", parseFloat((cur / ratio).toFixed(4)));
    } else {
      setParam("physical_size_y", cur);
      setParam("physical_size_x", parseFloat((cur * ratio).toFixed(4)));
    }
  };

  return (
    <div style={{ background: "#fff" }}>
      <style>{`
        .param-panel input[type=number]::-webkit-inner-spin-button,
        .param-panel input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .param-panel input[type=number] { -moz-appearance: textfield; }
        .param-panel input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #0a0a0a;
          cursor: pointer;
          transition: background 0.1s;
        }
        .param-panel input[type=range]:hover::-webkit-slider-thumb,
        .param-panel input[type=range]:active::-webkit-slider-thumb { background: #ff5500; }
        .param-panel input[type=range]::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%; background: #0a0a0a;
          cursor: pointer; border: none;
        }
      `}</style>

      <div className="param-panel">
        <Section label="Optics">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 28px" }}>
            <SliderRow label="refractive index n" paramKey="n" min={1.1} max={2.5} step={0.001} unit="" decimals={3} />
            <SliderRow label="thickness d" paramKey="thickness" min={0.001} max={0.02} step={0.0001} unit="mm" scale={1000} decimals={2} />
            <SliderRow label="projection dist L" paramKey="proj_dist" min={0.05} max={3.0} step={0.001} unit="m" decimals={3} />
            <SliderRow label="smoothing σ" paramKey="smoothing" min={0} max={10} step={0.05} unit="px" decimals={2} />
          </div>
          <div style={{ marginTop: 6, ...rowCss.selectRow }}>
            <span style={rowCss.name}>resolution</span>
            <select
              value={params.resolution}
              onChange={(e) => setParam("resolution", parseInt(e.target.value) as LensParams["resolution"])}
              style={rowCss.select}
            >
              {resOptions.map((r) => <option key={r} value={r}>{r}×{r}</option>)}
            </select>
          </div>
          <LightDirPicker />
          <SpotlightControl />
        </Section>

        <Section label="Geometry">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 28px" }}>
            <SliderRow label="base thickness" paramKey="base_thickness" min={0.001} max={0.01} step={0.0001} unit="mm" scale={1000} decimals={2} />
            <SliderRow label="lens width" paramKey="physical_size_x" min={0.01} max={0.3} step={0.001} unit="cm" scale={100} decimals={2} />
            <SliderRow label="lens height" paramKey="physical_size_y" min={0.01} max={0.3} step={0.001} unit="cm" scale={100} decimals={2} />
          </div>
          {targetImageSize && (
            <div style={{ marginTop: 4 }}>
              <button
                onClick={applyImageRatio}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase" as const,
                  border: "1px solid #e0e0e0",
                  background: "transparent",
                  color: "#888",
                  padding: "3px 10px",
                  cursor: "pointer",
                  outline: "none",
                  borderRadius: 0,
                }}
                title={`Image is ${targetImageSize.w}×${targetImageSize.h}`}
              >
                ↔ use image ratio ({targetImageSize.w}:{targetImageSize.h})
              </button>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}

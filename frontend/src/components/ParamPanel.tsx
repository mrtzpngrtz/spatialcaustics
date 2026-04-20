import { useState } from "react";
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
          <SliderRow label="refractive index n" paramKey="n" min={1.1} max={2.5} step={0.001} unit="" decimals={3} />
          <SliderRow label="thickness d" paramKey="thickness" min={0.001} max={0.02} step={0.0001} unit="mm" scale={1000} decimals={2} />
          <SliderRow label="projection dist L" paramKey="proj_dist" min={0.05} max={3.0} step={0.001} unit="m" decimals={3} />
          <SliderRow label="smoothing σ" paramKey="smoothing" min={0} max={10} step={0.05} unit="px" decimals={2} />
          <div style={{ marginTop: 14, ...rowCss.selectRow }}>
            <span style={rowCss.name}>resolution</span>
            <select
              value={params.resolution}
              onChange={(e) => setParam("resolution", parseInt(e.target.value) as LensParams["resolution"])}
              style={rowCss.select}
            >
              {resOptions.map((r) => <option key={r} value={r}>{r}×{r}</option>)}
            </select>
          </div>
        </Section>

        <Section label="Geometry">
          <SliderRow label="base thickness" paramKey="base_thickness" min={0.001} max={0.01} step={0.0001} unit="mm" scale={1000} decimals={2} />
          <SliderRow label="lens width" paramKey="physical_size_x" min={0.01} max={0.3} step={0.001} unit="cm" scale={100} decimals={2} />
          <SliderRow label="lens height" paramKey="physical_size_y" min={0.01} max={0.3} step={0.001} unit="cm" scale={100} decimals={2} />
          {targetImageSize && (
            <div style={{ marginTop: -6, marginBottom: 4 }}>
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

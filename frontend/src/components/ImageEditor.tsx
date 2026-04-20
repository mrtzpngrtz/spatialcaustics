import { useEffect, useRef, useState, useCallback } from "react";
import { useLensStore } from "../stores/lensStore";

interface Edits {
  invert: boolean;
  brightness: number;  // -100..100
  contrast: number;    // -100..100
  blackPoint: number;  // 0..254
  whitePoint: number;  // 1..255
  cropX: number;       // 0..1 (fraction of original)
  cropY: number;
  cropW: number;
  cropH: number;
}

const DEFAULT_EDITS: Edits = {
  invert: false,
  brightness: 0,
  contrast: 0,
  blackPoint: 0,
  whitePoint: 255,
  cropX: 0,
  cropY: 0,
  cropW: 1,
  cropH: 1,
};

const css: Record<string, React.CSSProperties> = {
  root: {
    padding: "0 20px 16px",
    background: "#ffffff",
  },
  header: {
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#888",
    marginBottom: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  row: { marginBottom: 12 },
  rowLabel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  name: {
    fontSize: 11,
    color: "#0a0a0a",
    fontFamily: "'JetBrains Mono', monospace",
  },
  value: {
    fontSize: 11,
    color: "#ff5500",
    fontFamily: "'JetBrains Mono', monospace",
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
  toggleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  toggle: {
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
  },
  toggleActive: {
    border: "1px solid #0a0a0a",
    background: "#0a0a0a",
    color: "#f8f8f6",
  },
  resetBtn: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    border: "none",
    background: "transparent",
    color: "#aaa",
    cursor: "pointer",
    padding: 0,
  },
  divider: { height: 1, background: "#e0e0e0", margin: "12px 0" },
  cropWrap: {
    position: "relative" as const,
    userSelect: "none" as const,
    cursor: "crosshair",
    background: "#f0f0f0",
    marginBottom: 8,
  },
  cropImg: {
    width: "100%",
    display: "block",
  },
  cropOverlay: {
    position: "absolute" as const,
    border: "2px solid #ff5500",
    boxSizing: "border-box" as const,
    pointerEvents: "none" as const,
  },
  cropDim: {
    position: "absolute" as const,
    background: "rgba(0,0,0,0.4)",
    pointerEvents: "none" as const,
  },
};

function applyEdits(
  src: HTMLImageElement,
  edits: Edits,
): { b64: string; dataUrl: string; w: number; h: number } {
  const srcW = src.naturalWidth;
  const srcH = src.naturalHeight;

  // Crop region in pixels
  const cx = Math.round(edits.cropX * srcW);
  const cy = Math.round(edits.cropY * srcH);
  const cw = Math.max(1, Math.round(edits.cropW * srcW));
  const ch = Math.max(1, Math.round(edits.cropH * srcH));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);

  const imageData = ctx.getImageData(0, 0, cw, ch);
  const data = imageData.data;

  const bp = edits.blackPoint;
  const wp = edits.whitePoint;
  const range = wp - bp || 1;

  // Pre-build LUT for brightness/contrast/levels
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    // Levels: remap [bp..wp] → [0..255]
    let v = ((i - bp) / range) * 255;
    v = Math.max(0, Math.min(255, v));

    // Brightness: add
    v += edits.brightness * 2.55;

    // Contrast: S-curve via factor
    const f = (259 * (edits.contrast + 255)) / (255 * (259 - edits.contrast));
    v = f * (v - 128) + 128;

    lut[i] = Math.max(0, Math.min(255, Math.round(v)));
  }

  for (let i = 0; i < data.length; i += 4) {
    let r = lut[data[i]];
    let g = lut[data[i + 1]];
    let b = lut[data[i + 2]];
    if (edits.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }

  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1];
  return { b64, dataUrl, w: cw, h: ch };
}

export function ImageEditor() {
  const { rawImage, setTargetImage } = useLensStore();
  const [edits, setEdits] = useState<Edits>(DEFAULT_EDITS);
  const [open, setOpen] = useState(false);

  // Crop drag state
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const srcImgRef = useRef<HTMLImageElement | null>(null);

  const rawDataUrl = rawImage ? `data:image/png;base64,${rawImage}` : null;

  // Re-apply edits whenever they change or rawImage changes
  useEffect(() => {
    if (!rawImage) return;
    const img = new window.Image();
    img.onload = () => {
      srcImgRef.current = img;
      const { b64, dataUrl, w, h } = applyEdits(img, edits);
      setTargetImage(b64, dataUrl, { w, h });
    };
    img.src = `data:image/png;base64,${rawImage}`;
  }, [rawImage, edits, setTargetImage]);

  const setEdit = useCallback(<K extends keyof Edits>(key: K, val: Edits[K]) => {
    setEdits((e) => ({ ...e, [key]: val }));
  }, []);

  const reset = useCallback(() => setEdits(DEFAULT_EDITS), []);

  // Crop drag handlers
  const getCropFrac = (e: React.MouseEvent) => {
    const el = cropRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pos = getCropFrac(e);
    if (!pos) return;
    setDragging(true);
    setDragStart(pos);
    setEdits((ed) => ({ ...ed, cropX: pos.x, cropY: pos.y, cropW: 0.001, cropH: 0.001 }));
    e.preventDefault();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart) return;
    const pos = getCropFrac(e);
    if (!pos) return;
    const x = Math.min(dragStart.x, pos.x);
    const y = Math.min(dragStart.y, pos.y);
    const w = Math.max(0.01, Math.abs(pos.x - dragStart.x));
    const h = Math.max(0.01, Math.abs(pos.y - dragStart.y));
    setEdits((ed) => ({ ...ed, cropX: x, cropY: y, cropW: w, cropH: h }));
  };

  const onMouseUp = () => {
    if (dragging) {
      setDragging(false);
      setDragStart(null);
    }
  };

  const resetCrop = () => setEdits((e) => ({ ...e, cropX: 0, cropY: 0, cropW: 1, cropH: 1 }));

  if (!rawImage) return null;

  const isDefaultEdits =
    !edits.invert &&
    edits.brightness === 0 &&
    edits.contrast === 0 &&
    edits.blackPoint === 0 &&
    edits.whitePoint === 255 &&
    edits.cropX === 0 &&
    edits.cropY === 0 &&
    edits.cropW === 1 &&
    edits.cropH === 1;

  return (
    <div style={css.root}>
      <style>{`
        .img-editor input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 14px; height: 14px;
          border-radius: 50%; background: #0a0a0a; cursor: pointer;
        }
        .img-editor input[type=range]::-webkit-slider-thumb:hover { background: #ff5500; }
        .img-editor input[type=range]::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: #0a0a0a; cursor: pointer; border: none;
        }
      `}</style>
      <div className="img-editor">
        <div style={css.header}>
          <span>Image Edit</span>
          <div style={{ display: "flex", gap: 8 }}>
            {!isDefaultEdits && (
              <button style={css.resetBtn} onClick={reset}>reset all</button>
            )}
            <button
              style={{ ...css.toggle, fontSize: 10 }}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "▲ hide" : "▼ show"}
            </button>
          </div>
        </div>

        {open && (
          <>
            {/* Crop */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...css.rowLabel, marginBottom: 6 }}>
                <span style={css.name}>crop</span>
                {(edits.cropX > 0 || edits.cropY > 0 || edits.cropW < 1 || edits.cropH < 1) && (
                  <button style={css.resetBtn} onClick={resetCrop}>reset</button>
                )}
              </div>
              <div
                ref={cropRef}
                style={css.cropWrap}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              >
                <img src={rawDataUrl!} style={css.cropImg} alt="crop source" draggable={false} />
                {/* dim areas outside crop */}
                <div style={{ ...css.cropDim, top: 0, left: 0, right: 0, height: `${edits.cropY * 100}%` }} />
                <div style={{ ...css.cropDim, bottom: 0, left: 0, right: 0, height: `${(1 - edits.cropY - edits.cropH) * 100}%` }} />
                <div style={{ ...css.cropDim, top: `${edits.cropY * 100}%`, left: 0, width: `${edits.cropX * 100}%`, height: `${edits.cropH * 100}%` }} />
                <div style={{ ...css.cropDim, top: `${edits.cropY * 100}%`, right: 0, width: `${(1 - edits.cropX - edits.cropW) * 100}%`, height: `${edits.cropH * 100}%` }} />
                {/* crop border */}
                <div style={{
                  ...css.cropOverlay,
                  left: `${edits.cropX * 100}%`,
                  top: `${edits.cropY * 100}%`,
                  width: `${edits.cropW * 100}%`,
                  height: `${edits.cropH * 100}%`,
                }} />
              </div>
              <span style={{ fontSize: 10, color: "#aaa", fontFamily: "'JetBrains Mono', monospace" }}>
                drag to select region
              </span>
            </div>

            <div style={css.divider} />

            {/* Invert */}
            <div style={css.toggleRow}>
              <span style={css.name}>invert</span>
              <button
                style={{ ...css.toggle, ...(edits.invert ? css.toggleActive : {}) }}
                onClick={() => setEdit("invert", !edits.invert)}
              >
                {edits.invert ? "on" : "off"}
              </button>
            </div>

            {/* Brightness */}
            <div style={css.row}>
              <div style={css.rowLabel}>
                <span style={css.name}>brightness</span>
                <span style={css.value}>{edits.brightness > 0 ? "+" : ""}{edits.brightness}</span>
              </div>
              <input type="range" min={-100} max={100} step={1}
                value={edits.brightness} style={css.slider}
                onChange={(e) => setEdit("brightness", parseInt(e.target.value))} />
            </div>

            {/* Contrast */}
            <div style={css.row}>
              <div style={css.rowLabel}>
                <span style={css.name}>contrast</span>
                <span style={css.value}>{edits.contrast > 0 ? "+" : ""}{edits.contrast}</span>
              </div>
              <input type="range" min={-100} max={100} step={1}
                value={edits.contrast} style={css.slider}
                onChange={(e) => setEdit("contrast", parseInt(e.target.value))} />
            </div>

            <div style={css.divider} />

            {/* Levels */}
            <div style={css.row}>
              <div style={css.rowLabel}>
                <span style={css.name}>black point</span>
                <span style={css.value}>{edits.blackPoint}</span>
              </div>
              <input type="range" min={0} max={254} step={1}
                value={edits.blackPoint} style={css.slider}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setEdits((ed) => ({ ...ed, blackPoint: v, whitePoint: Math.max(v + 1, ed.whitePoint) }));
                }} />
            </div>
            <div style={css.row}>
              <div style={css.rowLabel}>
                <span style={css.name}>white point</span>
                <span style={css.value}>{edits.whitePoint}</span>
              </div>
              <input type="range" min={1} max={255} step={1}
                value={edits.whitePoint} style={css.slider}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setEdits((ed) => ({ ...ed, whitePoint: v, blackPoint: Math.min(v - 1, ed.blackPoint) }));
                }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

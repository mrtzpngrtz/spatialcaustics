import { useState, useEffect } from "react";
import { useWebGLCaustic } from "../hooks/useWebGLCaustic";
import { useLensStore } from "../stores/lensStore";

const css: Record<string, React.CSSProperties> = {
  root: {
    border: "1px solid #e0e0e0",
    background: "#0a0a0a",
    position: "relative" as const,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
  },
  toolbar: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    zIndex: 2,
    pointerEvents: "none" as const,
  },
  label: {
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#555",
  },
  toggleWrap: {
    display: "flex",
    gap: 0,
    pointerEvents: "auto" as const,
  },
  toggleBtn: (active: boolean): React.CSSProperties => ({
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    fontFamily: "'JetBrains Mono', monospace",
    border: "1px solid #333",
    padding: "3px 10px",
    cursor: "pointer",
    background: active ? "#ff5500" : "transparent",
    color: active ? "#fff" : "#555",
    outline: "none",
    transition: "background 0.1s, color 0.1s",
  }),
  canvas: {
    display: "block",
    width: "100%",
    height: "100%",
  },
  cpuImg: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain" as const,
    imageRendering: "pixelated" as const,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: "#333",
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    position: "absolute" as const,
    inset: 0,
  },
  crosshair: {
    position: "absolute" as const,
    bottom: 16,
    right: 16,
    color: "#333",
    fontSize: 14,
    pointerEvents: "none" as const,
    zIndex: 1,
  },
};

export function CausticPreview() {
  const [mode, setMode] = useState<"webgl" | "cpu">("webgl");
  const { computeResult, params, simulatedCaustic } = useLensStore();

  const canvasRef = useWebGLCaustic({
    heightField: computeResult?.height_field ?? null,
    n: params.n,
    thickness: params.thickness,
    projDist: params.proj_dist,
    physicalSizeX: params.physical_size_x,
    physicalSizeY: params.physical_size_y,
  });

  const hasData = computeResult !== null;
  const hasCpu = simulatedCaustic !== null;
  const aspect = params.physical_size_x / params.physical_size_y; // w/h

  // Auto-switch to CPU when sim result arrives
  useEffect(() => {
    if (simulatedCaustic) setMode("cpu");
  }, [simulatedCaustic]);

  const modeLabel = mode === "webgl"
    ? "Caustic — WebGL"
    : "Caustic — CPU Validation";

  return (
    <div style={{ ...css.root, height: "100%", minHeight: 0 }}>
      <div style={css.toolbar}>
        <span style={css.label}>{modeLabel}</span>
        {hasData && (
          <div style={css.toggleWrap}>
            <button
              style={{ ...css.toggleBtn(mode === "webgl"), borderRight: "none" }}
              onClick={() => setMode("webgl")}
            >
              WebGL
            </button>
            <button
              style={css.toggleBtn(mode === "cpu")}
              onClick={() => setMode("cpu")}
              disabled={!hasCpu}
              title={hasCpu ? undefined : "Run compute to generate CPU validation"}
            >
              CPU
            </button>
          </div>
        )}
      </div>

      {!hasData && (
        <div style={css.empty}>awaiting computation</div>
      )}

      {/* WebGL canvas — always mounted when there's data, hidden in CPU mode */}
      {hasData && (
        <div style={{
          display: mode === "webgl" ? "flex" : "none",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          minHeight: 0,
        }}>
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              display: "block",
            }}
          />
        </div>
      )}

      {/* CPU sim — full panel */}
      {hasData && mode === "cpu" && (
        hasCpu ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
            <img
              src={`data:image/png;base64,${simulatedCaustic}`}
              alt="CPU caustic validation"
              style={{ maxWidth: "100%", maxHeight: "100%", display: "block", imageRendering: "pixelated" as const }}
            />
          </div>
        ) : (
          <div style={css.empty}>cpu sim not yet computed</div>
        )
      )}

      <span style={css.crosshair}>+</span>
    </div>
  );
}

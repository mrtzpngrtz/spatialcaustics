import { useThreeViewer } from "../hooks/useThreeViewer";

interface ThreeViewerProps {
  heightField: number[][] | null;
  physicalSizeX?: number;
  physicalSizeY?: number;
}

const css: Record<string, React.CSSProperties> = {
  root: {
    border: "1px solid #e0e0e0",
    background: "#f8f8f6",
    position: "relative" as const,
    overflow: "hidden",
  },
  label: {
    position: "absolute" as const,
    top: 12,
    left: 16,
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#888",
    zIndex: 1,
    pointerEvents: "none" as const,
  },
  container: {
    width: "100%",
    height: "100%",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: "#ccc",
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  crosshair: {
    position: "absolute" as const,
    bottom: 16,
    right: 16,
    color: "#ddd",
    fontSize: 14,
    pointerEvents: "none" as const,
    lineHeight: 1,
  },
};

export function ThreeViewer({ heightField, physicalSizeX, physicalSizeY }: ThreeViewerProps) {
  const containerRef = useThreeViewer({ heightField, physicalSizeX, physicalSizeY });

  return (
    <div style={{ ...css.root, height: "100%" }}>
      <span style={css.label}>3D Preview</span>
      <div ref={containerRef} style={css.container}>
        {!heightField && (
          <div style={css.empty}>awaiting computation</div>
        )}
      </div>
      <span style={css.crosshair}>+</span>
    </div>
  );
}

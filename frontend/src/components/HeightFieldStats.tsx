import type { ComputeResponse } from "../types/api";

interface HeightFieldStatsProps {
  result: ComputeResponse | null;
  thickness: number;
}

const css: Record<string, React.CSSProperties> = {
  root: {
    padding: "12px 20px 20px",
    background: "#ffffff",
  },
  header: {
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#888",
    marginBottom: 16,
    display: "block",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  stat: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  statLabel: {
    fontSize: 11,
    color: "#888",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  statValue: {
    fontSize: 24,
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 400,
    color: "#0a0a0a",
    lineHeight: 1,
  },
  statUnit: {
    fontSize: 11,
    color: "#888",
    fontFamily: "'JetBrains Mono', monospace",
    marginLeft: 4,
  },
  empty: {
    color: "#ccc",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  warning: {
    marginTop: 12,
    padding: "8px 12px",
    background: "#fff8f0",
    border: "1px solid #ff9944",
    borderRadius: 4,
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
    color: "#cc5500",
    lineHeight: 1.55,
  },
};

function computeStats(hf: number[][]): {
  min: number; max: number; mean: number; std: number;
} {
  let min = Infinity, max = -Infinity, sum = 0, count = 0;
  for (const row of hf) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count++;
    }
  }
  const mean = sum / count;
  let variance = 0;
  for (const row of hf) {
    for (const v of row) {
      variance += (v - mean) ** 2;
    }
  }
  return { min, max, mean, std: Math.sqrt(variance / count) };
}

export function HeightFieldStats({ result, thickness }: HeightFieldStatsProps) {
  if (!result) {
    return (
      <div style={css.root}>
        <span style={css.header}>Height Field</span>
        <span style={css.empty}>no data</span>
      </div>
    );
  }

  const { min, max, mean, std } = computeStats(result.height_field);
  const toMM = (v: number) => (v * 1000).toFixed(3);

  const convergedColor = result.converged ? "#22aa44" : "#dd8800";
  const convergedText = result.converged
    ? "yes"
    : `no / ${result.iterations_used} iter`;

  const rmsPercent = (result.final_rms_error * 100).toFixed(2);

  return (
    <div style={css.root}>
      <span style={css.header}>Height Field — {result.width}×{result.height}</span>
      <div style={css.grid}>
        <div style={css.stat}>
          <span style={css.statLabel}>Min</span>
          <span style={css.statValue}>
            {toMM(min)}<span style={css.statUnit}>mm</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Max</span>
          <span style={css.statValue}>
            {toMM(max)}<span style={css.statUnit}>mm</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Mean</span>
          <span style={css.statValue}>
            {toMM(mean)}<span style={css.statUnit}>mm</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Std Dev</span>
          <span style={css.statValue}>
            {toMM(std)}<span style={css.statUnit}>mm</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Phys. Thickness</span>
          <span style={{
            ...css.statValue,
            color: result.actual_thickness < thickness * 0.95 ? "#ff5500" : "#0a0a0a",
          }}>
            {(result.actual_thickness * 1000).toFixed(3)}<span style={css.statUnit}>mm</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Resolution</span>
          <span style={css.statValue}>
            {result.width}<span style={css.statUnit}>px</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Converged</span>
          <span style={{ ...css.statValue, fontSize: 14, color: convergedColor, paddingTop: 4 }}>
            {convergedText}
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Final RMS</span>
          <span style={{ ...css.statValue, fontSize: 14, paddingTop: 4 }}>
            {rmsPercent}<span style={css.statUnit}>%</span>
          </span>
        </div>
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <div>
          {result.warnings.map((w, i) => (
            <div key={i} style={css.warning}>
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import type { ComputeResponse } from "../types/api";

interface HeightFieldStatsProps {
  result: ComputeResponse | null;
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

export function HeightFieldStats({ result }: HeightFieldStatsProps) {
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
          <span style={css.statLabel}>Natural Depth</span>
          <span style={css.statValue}>
            {result.natural_depth_mm.toFixed(3)}<span style={css.statUnit}>mm</span>
          </span>
        </div>
        <div style={{ ...css.stat, gridColumn: "1 / -1" }}>
          <span style={css.statLabel}>Render dist = LENS_TO_WALL_M in Mitsuba</span>
          <span style={{ ...css.statValue, color: "#c60" }}>
            {result.effective_proj_dist.toFixed(3)}<span style={{ ...css.statUnit, color: "#c60" }}>m</span>
          </span>
        </div>
        <div style={css.stat}>
          <span style={css.statLabel}>Resolution</span>
          <span style={css.statValue}>
            {result.width}<span style={css.statUnit}>px</span>
          </span>
        </div>
      </div>
    </div>
  );
}

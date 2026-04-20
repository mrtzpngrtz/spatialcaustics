import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLensStore } from "../stores/lensStore";
import { ExportPanel } from "./ExportPanel";
import type { ComputeRequest, ComputeResponse, SimulateResponse } from "../types/api";

async function postCompute(req: ComputeRequest): Promise<ComputeResponse> {
  const res = await fetch("/api/compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(detail.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ComputeResponse>;
}


async function fetchSimulate(
  id: string,
  n: number,
  projDist: number,
  physicalSizeX: number,
  physicalSizeY: number,
): Promise<SimulateResponse> {
  const url = `/api/simulate?height_field_id=${encodeURIComponent(id)}&n=${n}&proj_dist=${projDist}&physical_size_x=${physicalSizeX}&physical_size_y=${physicalSizeY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(detail.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<SimulateResponse>;
}

const css: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 24px",
    borderBottom: "1px solid #e0e0e0",
    background: "#ffffff",
  },
  btn: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    border: "1px solid #0a0a0a",
    background: "transparent",
    color: "#0a0a0a",
    padding: "8px 20px",
    cursor: "pointer",
    outline: "none",
    transition: "background 0.1s, color 0.1s",
    borderRadius: 0,
  },
  btnPrimary: {
    background: "#0a0a0a",
    color: "#f8f8f6",
    border: "1px solid #0a0a0a",
  },
  btnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  status: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: "#888",
    marginLeft: "auto",
  },
  error: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: "#ff5500",
    marginLeft: "auto",
  },
  title: {
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "0.04em",
    color: "#0a0a0a",
    marginRight: 8,
  },
};

export function ControlBar() {
  const [exportOpen, setExportOpen] = useState(false);
  const {
    targetImage,
    params,
    computeResult,
    computeDirty,
    setComputeResult,
    setSimulatedCaustic,
  } = useLensStore();

  const simulateMutation = useMutation({
    mutationFn: ({ id, n, projDist, physicalSizeX, physicalSizeY }: { id: string; n: number; projDist: number; physicalSizeX: number; physicalSizeY: number }) =>
      fetchSimulate(id, n, projDist, physicalSizeX, physicalSizeY),
    onSuccess: (data) => {
      setSimulatedCaustic(data.caustic_image);
    },
  });

  const computeMutation = useMutation({
    mutationFn: (req: ComputeRequest) => postCompute(req),
    onSuccess: (data) => {
      setComputeResult(data);
      // Auto-run CPU sim immediately after solve
      simulateMutation.mutate({
        id: data.height_field_id,
        n: params.n,
        projDist: params.proj_dist,
        physicalSizeX: params.physical_size_x,
        physicalSizeY: params.physical_size_y,
      });
    },
  });

  const canCompute = targetImage !== null && !computeMutation.isPending;
  const canExport = computeResult !== null;

  const error =
    (computeMutation.error as Error | null)?.message ??
    (simulateMutation.error as Error | null)?.message ??
    null;

  const loading =
    computeMutation.isPending
      ? "computing…"
      : simulateMutation.isPending
        ? "simulating…"
        : null;

  return (
    <div style={css.root}>
      <span style={css.title}>Caustic Lens Designer</span>

      <button
        style={{
          ...css.btn,
          ...css.btnPrimary,
          ...(canCompute ? {} : css.btnDisabled),
        }}
        disabled={!canCompute}
        onClick={() => {
          if (!targetImage) return;
          computeMutation.mutate({
            image: targetImage,
            n: params.n,
            thickness: params.thickness,
            proj_dist: params.proj_dist,
            smoothing: params.smoothing,
            resolution: params.resolution,
            physical_size_x: params.physical_size_x,
            physical_size_y: params.physical_size_y,
          });
        }}
      >
        {computeDirty && <span style={{ marginRight: 6, fontSize: 13 }}>↻</span>}Compute
      </button>

      <button
        style={{
          ...css.btn,
          ...(canExport ? {} : css.btnDisabled),
        }}
        disabled={!canExport}
        onClick={() => setExportOpen(true)}
      >
        Export
      </button>

      {error && <span style={css.error}>{error}</span>}
      {loading && !error && <span style={css.status}>{loading}</span>}
      {!loading && !error && computeResult && (
        <span style={css.status}>
          {computeResult.width}×{computeResult.height} — ready
        </span>
      )}

      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}
    </div>
  );
}

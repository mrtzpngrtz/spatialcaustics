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
  sourceDistance: number | null,
): Promise<SimulateResponse> {
  let url = `/api/simulate?height_field_id=${encodeURIComponent(id)}&n=${n}&proj_dist=${projDist}&physical_size_x=${physicalSizeX}&physical_size_y=${physicalSizeY}`;
  if (sourceDistance !== null) url += `&source_distance=${sourceDistance}`;
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
  },
  error: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: "#ff5500",
  },
  title: {
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "0.04em",
    color: "#0a0a0a",
    marginRight: 8,
  },
};

function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", width: 480, padding: "28px 32px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", position: "relative" }}>
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 14, right: 18, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#aaa", lineHeight: 1, padding: 0 }}
        >✕</button>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#999", marginBottom: 18 }}>About</div>
        <p style={{ fontFamily: "Georgia, serif", fontSize: 13.5, lineHeight: 1.75, color: "#1a1a1a", margin: 0 }}>
          Spatial Caustics basiert auf der Methode von Schwartzburg et al. (2014, ETH Zürich). Gegeben ein Zielbild berechnet ein iterativer Solver (Monge-Ampère) das Höhenprofil einer Linse so, dass kollimiertes Licht durch Refraktion exakt dieses Bild als Caustic auf eine Wand projiziert. Die Linse kann als STL exportiert, gedruckt oder gegossen werden.
        </p>
        <div style={{ marginTop: 20, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#bbb" }}>
          Schwartzburg, Y., Testuz, R., Tagliasacchi, A., Pauly, M. (2014). <em>Computational Caustic Design.</em> ACM Transactions on Graphics, 33(4). ETH Zürich.
        </div>
      </div>
    </div>
  );
}

export function ControlBar() {
  const [exportOpen, setExportOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const {
    targetImage,
    params,
    computeResult,
    computeDirty,
    setComputeResult,
    setSimulatedCaustic,
  } = useLensStore();

  const simulateMutation = useMutation({
    mutationFn: ({ id, n, projDist, physicalSizeX, physicalSizeY, sourceDistance }: { id: string; n: number; projDist: number; physicalSizeX: number; physicalSizeY: number; sourceDistance: number | null }) =>
      fetchSimulate(id, n, projDist, physicalSizeX, physicalSizeY, sourceDistance),
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
        projDist: data.effective_proj_dist,
        physicalSizeX: params.physical_size_x,
        physicalSizeY: params.physical_size_y,
        sourceDistance: params.source_distance,
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
            incident_theta: params.incident_theta,
            incident_phi: params.incident_phi,
            source_distance: params.source_distance,
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

      <button style={{ ...css.btn, marginLeft: "auto" }} onClick={() => setAboutOpen(true)}>About</button>

      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

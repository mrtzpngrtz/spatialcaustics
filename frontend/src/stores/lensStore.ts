import { create } from "zustand";
import type { LensParams, ComputeResponse } from "../types/api";

interface MoldParams {
  border_height: number;   // m — wall height above cavity
  wall_thickness: number;  // m — wall thickness around cavity
}

interface LensState {
  // Input
  rawImage: string | null;          // original uploaded base64 (never modified)
  targetImage: string | null;       // base64 (may be processed)
  targetImageUrl: string | null;    // data URL for preview
  targetImageSize: { w: number; h: number } | null;
  params: LensParams;
  moldParams: MoldParams;

  // Results
  computeResult: ComputeResponse | null;
  simulatedCaustic: string | null;  // base64 PNG
  currentProjectName: string | null;
  currentProjectId: string | null;
  computeDirty: boolean;            // true when inputs changed since last compute

  // Actions
  setTargetImage: (b64: string, url: string, size?: { w: number; h: number }) => void;
  setRawImage: (b64: string) => void;
  setParam: <K extends keyof LensParams>(key: K, value: LensParams[K]) => void;
  setMoldParam: (key: keyof MoldParams, value: number) => void;
  setComputeResult: (result: ComputeResponse) => void;
  setSimulatedCaustic: (b64: string) => void;
  setCurrentProjectName: (name: string | null) => void;
  setCurrentProjectId: (id: string | null) => void;
  reset: () => void;
}

const DEFAULT_PARAMS: LensParams = {
  n: 1.49,
  thickness: 0.003,
  proj_dist: 0.5,
  smoothing: 0,
  resolution: 256,
  base_thickness: 0.002,
  physical_size_x: 0.05,
  physical_size_y: 0.05,
  incident_theta: 0,
  incident_phi: 0,
  source_distance: null,
};

const DEFAULT_MOLD_PARAMS: MoldParams = {
  border_height: 0.0005,  // 0.5 mm
  wall_thickness: 0.003,  // 3 mm
};

const MOLD_STORAGE_KEY = "caustic_mold_params";

function loadMoldParams(): MoldParams {
  try {
    const raw = localStorage.getItem(MOLD_STORAGE_KEY);
    if (raw) return { ...DEFAULT_MOLD_PARAMS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_MOLD_PARAMS;
}

function saveMoldParams(p: MoldParams) {
  try { localStorage.setItem(MOLD_STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export type { MoldParams };

export const useLensStore = create<LensState>((set) => ({
  rawImage: null,
  targetImage: null,
  targetImageUrl: null,
  targetImageSize: null,
  params: DEFAULT_PARAMS,
  moldParams: loadMoldParams(),
  computeResult: null,
  simulatedCaustic: null,
  currentProjectName: null,
  currentProjectId: null,
  computeDirty: false,

  setTargetImage: (b64, url, size) =>
    set({
      targetImage: b64,
      targetImageUrl: url,
      targetImageSize: size ?? null,
      computeResult: null,
      simulatedCaustic: null,
      computeDirty: true,
    }),

  setRawImage: (b64: string) => set({ rawImage: b64 }),

  setCurrentProjectName: (name) => set({ currentProjectName: name }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  setParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: value }, computeDirty: true })),

  setMoldParam: (key, value) =>
    set((s) => {
      const next = { ...s.moldParams, [key]: value };
      saveMoldParams(next);
      return { moldParams: next };
    }),

  setComputeResult: (result) => set({ computeResult: result, computeDirty: false }),

  setSimulatedCaustic: (b64) => set({ simulatedCaustic: b64 }),

  reset: () =>
    set({
      rawImage: null,
      targetImage: null,
      targetImageUrl: null,
      targetImageSize: null,
      computeResult: null,
      simulatedCaustic: null,
      currentProjectName: null,
      currentProjectId: null,
      params: DEFAULT_PARAMS,
      moldParams: DEFAULT_MOLD_PARAMS,
      computeDirty: false,
    }),
}));

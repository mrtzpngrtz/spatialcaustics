import { create } from "zustand";
import type { LensParams, ComputeResponse } from "../types/api";

interface MoldParams {
  border_height: number;   // m — wall height above cavity
  wall_thickness: number;  // m — wall thickness around cavity
}

// Valid ranges matching backend Pydantic validators and UI slider bounds
const PARAM_BOUNDS: Partial<Record<keyof LensParams, [number, number]>> = {
  n:               [1.0,    3.0],
  thickness:       [0.0001, 0.05],
  proj_dist:       [0.05,   5.0],
  smoothing:       [0,      20],
  resolution:      [32,     2048],
  base_thickness:  [0.0001, 0.02],
  physical_size_x: [0.01,   0.5],
  physical_size_y: [0.01,   0.5],
  incident_theta:  [0,      85],
  incident_phi:    [0,      359.9],
  source_distance: [0.05,   5.0],  // null handled separately
  magnification:   [0.5,    5.0],
};

function clampParam<K extends keyof LensParams>(key: K, value: LensParams[K]): LensParams[K] {
  if (key === "source_distance") {
    if (value === null) return null as LensParams[K];
    const n = Number(value);
    if (!isFinite(n) || n <= 0) return null as LensParams[K];
    return Math.min(5.0, Math.max(0.05, n)) as LensParams[K];
  }
  const bounds = PARAM_BOUNDS[key];
  if (!bounds || typeof value !== "number" || !isFinite(value)) return value;
  return Math.min(bounds[1], Math.max(bounds[0], value)) as LensParams[K];
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
  loadParams: (raw: Partial<LensParams>) => void;
  setMoldParam: (key: keyof MoldParams, value: number) => void;
  setComputeResult: (result: ComputeResponse) => void;
  setSimulatedCaustic: (b64: string) => void;
  setCurrentProjectName: (name: string | null) => void;
  setCurrentProjectId: (id: string | null) => void;
  reset: () => void;
}

const DEFAULT_PARAMS: LensParams = {
  n: 1.49,
  thickness: 0.005,   // safety clamp only — not user-editable
  proj_dist: 0.5,
  smoothing: 1,
  resolution: 256,
  base_thickness: 0.002,
  physical_size_x: 0.05,
  physical_size_y: 0.05,
  incident_theta: 0,
  incident_phi: 0,
  source_distance: null,
  magnification: 1.0,
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

  loadParams: (raw) =>
    set((s) => {
      const next = { ...s.params };
      (Object.keys(raw) as Array<keyof LensParams>).forEach((k) => {
        (next[k] as LensParams[typeof k]) = clampParam(k, raw[k] as LensParams[typeof k]);
      });
      return { params: next, computeDirty: true };
    }),

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

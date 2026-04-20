export interface ComputeRequest {
  image: string;
  n: number;
  thickness: number;
  proj_dist: number;
  smoothing: number;
  resolution: number;
  physical_size_x: number;
  physical_size_y: number;
}

export interface ComputeResponse {
  height_field: number[][];
  width: number;
  height: number;
  height_field_id: string;
}

export interface ExportSTLRequest {
  height_field: number[][];
  thickness: number;
  base_thickness: number;
  physical_size_x: number;
  physical_size_y: number;
  negative?: boolean;
  border_height?: number;
  wall_thickness?: number;
}

export interface SimulateResponse {
  caustic_image: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  created_at: string;
  has_height_field: boolean;
  resolution: number | null;
}

export interface ProjectFull {
  id: string;
  name: string;
  created_at: string;
  params: LensParams;
  target_image: string;
  height_field?: number[][];
}

export interface LensParams {
  n: number;
  thickness: number;
  proj_dist: number;
  smoothing: number;
  resolution: number;
  base_thickness: number;
  physical_size_x: number;
  physical_size_y: number;
}

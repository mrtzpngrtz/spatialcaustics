"""
FastAPI backend for caustic lens design.
"""

import uuid
import logging
import numpy as np
from numpy.typing import NDArray
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Any

from solver import run_solver
from stl_export import height_field_to_stl, height_field_to_mold_stl, height_field_to_container_stl
from simulation import simulate_to_base64
from projects import list_projects, save_project, update_project, load_project, delete_project, rename_project

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Caustic Lens Designer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for height fields (keyed by UUID)
# In production, use Redis or disk-backed storage.
_height_field_store: dict[str, NDArray[np.float64]] = {}
_height_field_meta: dict[str, dict[str, Any]] = {}


# ── Request / Response models ──────────────────────────────────────────────────

class ComputeRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded PNG/JPG target image")
    n: float = Field(1.49, ge=1.0, le=3.0, description="Refractive index")
    thickness: float = Field(0.003, gt=0.0, le=0.05, description="Max lens thickness (m)")
    proj_dist: float = Field(0.5, gt=0.0, le=5.0, description="Projection distance (m)")
    smoothing: float = Field(1.0, ge=0.0, le=20.0, description="Gaussian smoothing sigma (px)")
    resolution: int = Field(256, ge=32, le=2048, description="Solver grid resolution")
    physical_size_x: float = Field(0.05, gt=0.01, le=0.5, description="Lens width (m)")
    physical_size_y: float = Field(0.05, gt=0.01, le=0.5, description="Lens height (m)")
    incident_theta: float = Field(0.0, ge=0.0, le=85.0, description="Incident light elevation from normal (deg)")
    incident_phi: float = Field(0.0, ge=0.0, lt=360.0, description="Incident light azimuth (deg, 0=+Y)")
    source_distance: float | None = Field(None, description="Point-source distance above lens (m). None=collimated.")

    @field_validator("image")
    @classmethod
    def image_not_empty(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("image field appears empty")
        return v


class ComputeResponse(BaseModel):
    height_field: list[list[float]]
    width: int
    height: int
    height_field_id: str


class SaveProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    params: dict[str, Any]
    target_image: str = Field(..., description="Base64-encoded target image")
    height_field: list[list[float]] | None = None


class RenameProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class ExportSTLRequest(BaseModel):
    height_field: list[list[float]]
    thickness: float = Field(0.003, gt=0.0, le=0.05)
    base_thickness: float = Field(0.002, gt=0.0, le=0.02)
    physical_size_x: float = Field(0.05, gt=0.01, le=0.5)
    physical_size_y: float = Field(0.05, gt=0.01, le=0.5)
    negative: bool = Field(False, description="Export mold (negative) instead of lens")
    border_height: float = Field(0.0005, ge=0.0, le=0.1, description="Mold border wall height above cavity (m)")
    wall_thickness: float = Field(0.003, gt=0.0, le=0.05, description="Mold wall thickness (m)")
    base_curve_radius: float | None = Field(None, description="Spherical base radius (m) for biconvex lens. None = flat.")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/api/compute", response_model=ComputeResponse)
async def compute_height_field(req: ComputeRequest) -> ComputeResponse:
    """
    Run inverse caustic solver. Returns height field and a store ID
    that can be referenced by /api/simulate.
    """
    try:
        h = run_solver(
            image_b64=req.image,
            n_refract=req.n,
            thickness=req.thickness,
            proj_dist=req.proj_dist,
            smoothing=req.smoothing,
            resolution=req.resolution,
            physical_size_x=req.physical_size_x,
            physical_size_y=req.physical_size_y,
            incident_theta=req.incident_theta,
            incident_phi=req.incident_phi,
            source_distance=req.source_distance,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Solver error")
        raise HTTPException(status_code=500, detail=f"Solver failed: {e}")

    field_id = str(uuid.uuid4())
    _height_field_store[field_id] = h
    _height_field_meta[field_id] = {
        "n": req.n,
        "thickness": req.thickness,
        "proj_dist": req.proj_dist,
        "physical_size_x": req.physical_size_x,
        "physical_size_y": req.physical_size_y,
    }

    # Prune store if it grows large (keep last 20)
    if len(_height_field_store) > 20:
        oldest = next(iter(_height_field_store))
        _height_field_store.pop(oldest, None)
        _height_field_meta.pop(oldest, None)

    ny, nx = h.shape
    return ComputeResponse(
        height_field=h.tolist(),
        width=nx,
        height=ny,
        height_field_id=field_id,
    )


@app.post("/api/export-stl")
async def export_stl(req: ExportSTLRequest) -> Response:
    """
    Convert provided height field to watertight binary STL.
    """
    try:
        h = np.array(req.height_field, dtype=np.float64)
        if h.ndim != 2:
            raise ValueError("height_field must be a 2D array")
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        if req.negative:
            stl_bytes = height_field_to_mold_stl(
                height_field=h,
                thickness=req.thickness,
                base_thickness=req.base_thickness,
                physical_size_x=req.physical_size_x,
                physical_size_y=req.physical_size_y,
                border_height=req.border_height,
                wall_thickness=req.wall_thickness,
            )
        else:
            stl_bytes = height_field_to_stl(
                height_field=h,
                thickness=req.thickness,
                base_thickness=req.base_thickness,
                physical_size=req.physical_size_x,
                physical_size_y=req.physical_size_y,
                base_curve_radius=req.base_curve_radius,
            )
    except Exception as e:
        logger.exception("STL export error")
        raise HTTPException(status_code=500, detail=f"STL export failed: {e}")

    filename = "caustic_mold.stl" if req.negative else "caustic_lens.stl"
    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class ExportContainerRequest(BaseModel):
    physical_size_x: float = Field(0.05, gt=0.01, le=0.5)
    physical_size_y: float = Field(0.05, gt=0.01, le=0.5)
    lens_total_thickness: float = Field(0.005, gt=0.0, le=0.1)
    wall_thickness: float = Field(0.003, ge=0.0005, le=0.05)
    bottom_height: float = Field(0.002, gt=0.0, le=0.05, description="Solid base height below pocket (m)")
    clearance: float = Field(0.0003, ge=0.0, le=0.05)
    extra_wall_height: float = Field(0.0, ge=0.0, le=0.05, description="Extra wall height above lens surface (m)")


@app.post("/api/export-container")
async def export_container(req: ExportContainerRequest) -> Response:
    try:
        stl_bytes = height_field_to_container_stl(
            physical_size_x=req.physical_size_x,
            physical_size_y=req.physical_size_y,
            lens_total_thickness=req.lens_total_thickness,
            wall_thickness=req.wall_thickness,
            bottom_height=req.bottom_height,
            clearance=req.clearance,
            extra_wall_height=req.extra_wall_height,
        )
    except Exception as e:
        logger.exception("Container STL export error")
        raise HTTPException(status_code=500, detail=f"Container export failed: {e}")

    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="caustic_holder.stl"'},
    )


@app.get("/api/simulate")
async def simulate_caustic(
    height_field_id: str,
    n: float = 1.49,
    proj_dist: float = 0.5,
    physical_size_x: float = 0.05,
    physical_size_y: float = 0.05,
    source_distance: float | None = None,
) -> dict[str, str]:
    """
    Run CPU forward caustic simulation on a previously computed height field.
    Returns base64-encoded PNG of simulated caustic.
    """
    h = _height_field_store.get(height_field_id)
    if h is None:
        raise HTTPException(
            status_code=404,
            detail=f"Height field '{height_field_id}' not found. Re-run /api/compute.",
        )

    try:
        caustic_b64 = simulate_to_base64(
            h=h,
            n_refract=n,
            proj_dist=proj_dist,
            output_resolution=512,
            physical_size_x=physical_size_x,
            physical_size_y=physical_size_y,
            source_distance=source_distance,
        )
    except Exception as e:
        logger.exception("Simulation error")
        raise HTTPException(status_code=500, detail=f"Simulation failed: {e}")

    return {"caustic_image": caustic_b64}


@app.get("/api/projects")
async def get_projects() -> list[dict[str, Any]]:
    return list_projects()


@app.post("/api/projects", status_code=201)
async def create_project(req: SaveProjectRequest) -> dict[str, Any]:
    try:
        return save_project(
            name=req.name,
            params=req.params,
            target_image=req.target_image,
            height_field=req.height_field,
        )
    except Exception as e:
        logger.exception("Save project error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    try:
        return load_project(project_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found")


@app.put("/api/projects/{project_id}")
async def put_project(project_id: str, req: SaveProjectRequest) -> dict[str, Any]:
    try:
        return update_project(
            project_id=project_id,
            params=req.params,
            target_image=req.target_image,
            height_field=req.height_field,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found")
    except Exception as e:
        logger.exception("Update project error")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/projects/{project_id}")
async def patch_project(project_id: str, req: RenameProjectRequest) -> dict[str, str]:
    try:
        rename_project(project_id, req.name)
        return {"status": "ok"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found")


@app.delete("/api/projects/{project_id}", status_code=204)
async def remove_project(project_id: str) -> None:
    try:
        delete_project(project_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

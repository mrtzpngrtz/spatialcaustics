"""
Project persistence — save/load caustic lens projects to disk.

Each project is a JSON file in the projects/ directory:
  {id}.json  →  { id, name, created_at, params, target_image, height_field? }
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECTS_DIR = Path(__file__).parent / "projects"
PROJECTS_DIR.mkdir(exist_ok=True)


def _path(project_id: str) -> Path:
    # Sanitize: only allow valid UUID chars
    if not all(c in "0123456789abcdef-" for c in project_id.lower()):
        raise ValueError(f"Invalid project id: {project_id!r}")
    return PROJECTS_DIR / f"{project_id}.json"


def list_projects() -> list[dict[str, Any]]:
    """Return all projects sorted by created_at descending (newest first)."""
    results = []
    for f in PROJECTS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            results.append({
                "id": data["id"],
                "name": data["name"],
                "created_at": data["created_at"],
                "has_height_field": "height_field" in data,
                "resolution": data.get("params", {}).get("resolution"),
            })
        except Exception:
            continue
    results.sort(key=lambda x: x["created_at"], reverse=True)
    return results


def save_project(
    name: str,
    params: dict[str, Any],
    target_image: str,
    height_field: list[list[float]] | None = None,
) -> dict[str, Any]:
    """Persist a project and return its metadata."""
    project_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    data: dict[str, Any] = {
        "id": project_id,
        "name": name,
        "created_at": now,
        "params": params,
        "target_image": target_image,
    }
    if height_field is not None:
        data["height_field"] = height_field

    _path(project_id).write_text(
        json.dumps(data, separators=(",", ":")),
        encoding="utf-8",
    )
    return {
        "id": project_id,
        "name": name,
        "created_at": now,
        "has_height_field": height_field is not None,
    }


def load_project(project_id: str) -> dict[str, Any]:
    """Load and return full project data."""
    p = _path(project_id)
    if not p.exists():
        raise FileNotFoundError(project_id)
    return json.loads(p.read_text(encoding="utf-8"))


def delete_project(project_id: str) -> None:
    """Delete a project file."""
    p = _path(project_id)
    if not p.exists():
        raise FileNotFoundError(project_id)
    p.unlink()


def update_project(
    project_id: str,
    params: dict[str, Any],
    target_image: str,
    height_field: list[list[float]] | None = None,
) -> dict[str, Any]:
    """Overwrite an existing project's data (keeps id, name, created_at)."""
    p = _path(project_id)
    if not p.exists():
        raise FileNotFoundError(project_id)
    data = json.loads(p.read_text(encoding="utf-8"))
    data["params"] = params
    data["target_image"] = target_image
    if height_field is not None:
        data["height_field"] = height_field
    elif "height_field" in data:
        del data["height_field"]
    p.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return {
        "id": data["id"],
        "name": data["name"],
        "created_at": data["created_at"],
        "has_height_field": height_field is not None,
    }


def rename_project(project_id: str, new_name: str) -> None:
    """Rename a project in place."""
    p = _path(project_id)
    if not p.exists():
        raise FileNotFoundError(project_id)
    data = json.loads(p.read_text(encoding="utf-8"))
    data["name"] = new_name
    p.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

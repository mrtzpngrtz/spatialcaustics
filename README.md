# Caustic Lens Designer

Inverse caustic design tool: upload a target image → compute refractive height field → preview in-browser → export watertight STL.

## Setup

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Architecture

```
backend/
  main.py        FastAPI routes
  solver.py      Monge-Ampère iterative solver (Schwartzburg 2014)
  simulation.py  CPU forward caustic (ray splatting)
  stl_export.py  Watertight STL from height field

frontend/src/
  components/    React UI components
  hooks/         Three.js viewer + WebGL caustic
  stores/        Zustand state
  shaders/       GLSL caustic simulation
  types/         Shared TypeScript interfaces
```

## Physics

- Paraxial deflection: `t = (n−1)·d·∇h`
- Transport map: `Φ(x) = x + L·t(x)`
- Jacobian: `det(dΦ/dx) ≈ 1 + L·(n−1)·d·Δh`
- Inverse: iterative Poisson solve on intensity error

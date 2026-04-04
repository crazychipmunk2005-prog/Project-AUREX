# AUREX Current App State (What Exists Today + Why)

This is a short, practical snapshot of what is currently implemented in the app and the reasoning behind each major choice.

## 1) Product Focus Right Now

- **What it does:** A Kerala-focused thermal exploration app with a map timeline and on-demand analysis.
- **Primary UX:** Explore heat overlays on a Leaflet map, geocode city inputs, run analysis for selected seasonal windows, and inspect cursor probe values.
- **Why this shape:** It keeps the portfolio story clear: geospatial interaction first, climate/thermal context second, minimal user friction.

## 2) Frontend (React + Vite + TypeScript + Leaflet)

- **Stack:** React 19, Vite, TypeScript, Leaflet (`frontend/package.json`).
- **Why:**
  - React + Vite gives fast local iteration and simple deployment.
  - TypeScript reduces UI/API contract mistakes.
  - Leaflet is lightweight, free, and reliable for raster tile overlays.

### Key Frontend Features

- **Kerala-locked map extent** (`frontend/src/App.tsx`): fixed center/bounds keep interaction in intended study area.
- **TiTiler overlay URL generation** (`frontend/src/App.tsx`): builds tile URLs from seasonal Landsat COG files (2019-2025).
- **Seasonal timeline controls** (`frontend/src/components/ControlPanel.tsx`): month/day selection across years for same-day comparison.
- **Analysis mode toggle** (`absolute` / `anomaly`) (`frontend/src/components/ControlPanel.tsx`): supports two interpretation modes without changing map workflow.
- **Basemap and opacity controls** (`frontend/src/components/ui/LayerControls.tsx`): helps users balance context map vs thermal layer readability.
- **Cursor probe panel** (`frontend/src/components/ui/CursorProbePanel.tsx`): quick point-level data feedback for exploratory use.
- **Why these features:** They emphasize interpretability and speed over complex dashboards.

### State and API Handling

- **Custom global store with `useSyncExternalStore`** (`frontend/src/store/mapStore.ts`) instead of Redux/Zustand.
- **Why:** Small app footprint, low boilerplate, and explicit control over map interaction state.
- **Axios API client + normalized error mapping** (`frontend/src/api/client.ts`).
- **Why:** Consistent error messages and lightweight retry behavior improve perceived reliability.

### Geocoding

- **Provider:** OpenStreetMap Nominatim (`frontend/src/api/geocoder.ts`).
- **Why:** Free, no API key burden, and adequate for city/district-level targeting.
- **Added heuristics:** settlement/district filtering, nearest polygon picking, and radius bbox fallback.
- **Why:** Raw Nominatim results can be noisy; heuristics improve practical map-centering behavior.

## 3) Backend (FastAPI + GEE Service Path)

- **Stack:** FastAPI, Pydantic, Earth Engine API (`requirements.txt`, `backend/main.py`).
- **Endpoints:** `/health`, `/api/heatmap`, `/api/probe` (`backend/routes/*.py`).
- **Why:** FastAPI gives a small, typed API surface for heatmap/probe operations with minimal overhead.

### Runtime Behavior

- **Heatmap route:** validates request, caches responses, and calls GEE service in a thread (`backend/routes/heatmap.py`).
- **Probe route:** same pattern for point-level stats.
- **Why `asyncio.to_thread`:** Earth Engine client is sync; offloading avoids blocking async request handling.

### Security and Guardrails

- **Internal API key check** (`backend/utils/auth.py`).
- **CORS allowlist + security headers + request size limit** (`backend/main.py`, `backend/utils/security_headers.py`).
- **BBox/date validation with area cap (50,000 km2)** (`backend/models/heatmap.py`).
- **Why:** Protects free-tier resources, reduces abuse risk, and prevents expensive invalid geospatial requests.

### Caching

- **In-memory cache with TTL and simple eviction** (`backend/utils/cache.py`).
- **Why:** Zero-infra development cache that improves response time and reduces repeated GEE calls.

### Data/Science Logic Currently Used

- **Primary source in service:** Landsat 8/9 thermal band (`backend/services/gee_service.py`).
- **Anomaly mode:** compares target window to a 2019-2023 baseline.
- **Probe adds wind context:** ERA5-Land wind components.
- **Why:** Landsat gives finer local detail (~30m) than coarse products, which improves visual hotspot interpretation.

## 4) Static Assets + Export Pipeline Elements

- **Static tile source pattern:** TiTiler URL pointing at public COG files in `x-data/v1/...` (currently GitHub raw-hosted path in app defaults).
- **GEE export scripts present:** `scripts/gee/export_westcoast_context_monthly.js`, `scripts/gee/export_westcoast_context_landsat_lst_monthly.js`.
- **Why:** Keep heavy satellite processing in export scripts and use simple HTTP-served rasters at runtime where possible.

## 5) Dev/Run Workflow

- **Frontend dev:** `npm run dev` in `frontend`.
- **Backend dev:** `run_backend.bat` runs uvicorn on port 8001.
- **Combined start:** `start_aurex.bat` launches both app parts.
- **Why:** Batch scripts make local startup easier for Windows-first workflow.

## 6) Important Current Notes

- **Architecture docs vs code differ in places:** mandates describe static-first TiTiler runtime, while backend still includes live GEE analysis endpoints.
- **Port mismatch exists in scripts:** frontend default backend URL is `8001`, while `start_aurex.bat` starts backend on `8000`.
- **Fallback behavior in service exists for failures/demo:** intended to keep UI responsive even when GEE path is unavailable.
- **Why keep these for now:** practical resilience during active transition and portfolio iteration.

---

If needed, this can be split into a formal "Current State" + "Target State" pair so team decisions and transition steps are clearer.

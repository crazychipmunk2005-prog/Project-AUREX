# Sprint Tasks

> This is the single source of truth for active development work.
> Feed the relevant task block to your AI tool alongside CONTEXT.md and CONVENTIONS.md.
> Update status here as tasks move. Never start a task without defined acceptance criteria.

---

## Active Sprint: Sprint 2 — Location Search + User Input

_Sprint 1 backend scope is complete and running locally (TASK-001 through TASK-003)._
✅ **Session 3 Complete:** .env configured, uvicorn server running, health endpoint verified.

**Sprint Goal:**
Add user-driven location and date inputs on top of the deployed Sprint 1 backend.
Sprint focus is Nominatim search + date range controls with stable API integration.

**Definition of Done:**
- City search returns selectable Nominatim results and updates bbox reliably
- Date range selector enforces product validation rules and triggers heatmap refresh
- Backend startup uses FastAPI lifespan (no deprecated startup event pattern)
- Existing `/api/heatmap` flow remains stable (no regression in response envelope/caching)
- No secrets committed, no crashes, no placeholder code

---

### TASK-001 — FastAPI Project Scaffold
**Status:** Completed
**Blocked by:** Nothing

**Acceptance criteria:**
- Folder structure matches ARCHITECTURE.md exactly
- `/health` endpoint returns `{"status": "ok", "version": "1.0.0"}`
- `pydantic-settings` reads config from `.env` via `Settings` class in `config/settings.py`
- CORS middleware configured (allow origin from `ALLOWED_ORIGINS` env var)
- GEE initializes via service account during app startup (FastAPI lifespan)
- If GEE auth fails on startup, server logs the error and raises — does not silently continue
- `.env.example` committed with all required keys and placeholder values

**Files to create:**
```
backend/main.py
backend/config/settings.py
backend/routes/health.py
backend/utils/exceptions.py
backend/utils/cache.py          ← in-memory dict cache implementation
.env.example
requirements.txt
```

**Context snippet for AI:**
> "Create the FastAPI project skeleton for an Urban Heat Island platform.
> Follow CONTEXT.md, CONVENTIONS.md, and ARCHITECTURE.md exactly.
> GEE auth uses a service account key file at the path defined in settings.
> All settings come from pydantic-settings / .env.
> The task is complete when /health returns 200 and GEE initializes on startup."

---

### TASK-002 — GEE Service: LST Tile Generation
**Status:** Completed
**Blocked by:** TASK-001, GEE account setup

**Acceptance criteria:**
- `gee_service.get_lst_tile(bbox, start_date, end_date) -> str` returns a valid Leaflet tile URL
- Uses MODIS MOD11A2, band `LST_Day_1km`
- Applies scale factor (× 0.02) and offset (− 273.15) to convert raw values to Celsius
- Color palette applied: `['#313695', '#74add1', '#ffffbf', '#f46d43', '#a50026']`
  (blue = cool → yellow = moderate → red = hot)
- Returns `reduceRegion` stats alongside tile URL: `{min_temp, max_temp, mean_temp}`
- Wrapped in `try/except ee.EEException` — raises `GEEServiceError` on failure
- Function is pure synchronous (will be called via `asyncio.to_thread` in the route)
- GEE collection always filtered by bbox AND date before any operation

**Files to create:**
```
backend/services/gee_service.py
backend/models/heatmap.py       ← Pydantic models: HeatmapRequest, HeatmapResponse, BBox
```

**Context snippet for AI:**
> "Implement gee_service.get_lst_tile() for an Urban Heat Island platform.
> Dataset: MODIS/061/MOD11A2, band LST_Day_1km.
> Scale factor: 0.02, offset: -273.15 (result in Celsius).
> Apply a temperature color palette. Return getMapId() tile URL and reduceRegion stats.
> Follow CONTEXT.md + CONVENTIONS.md exactly. No Landsat. MODIS only."

---

### TASK-003 — /api/heatmap Endpoint
**Status:** Completed
**Blocked by:** TASK-002

**Acceptance criteria:**
- `POST /api/heatmap` accepts body: `{bbox: [minLon, minLat, maxLon, maxLat], start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD"}`
- Pydantic validates: bbox has exactly 4 floats, bbox area ≤ 50,000 km², dates are valid ISO format, end > start
- Cache check before calling GEE (cache key = SHA256 hash of request params)
- GEE call wrapped in `asyncio.to_thread()`
- Returns standard envelope: `{success, data: {tile_url, stats: {min_temp, max_temp, mean_temp}}, cached, error}`
- HTTP 422 for invalid input (Pydantic handles this automatically)
- HTTP 503 for GEE failure (GEEServiceError caught in handler)
- Response includes `cached: true` when served from cache

**Files to create:**
```
backend/routes/heatmap.py
```

---

### TASK-004 — React Frontend Scaffold
**Status:** Not started
**Blocked by:** Nothing (can run parallel to TASK-001)

**Acceptance criteria:**
- Vite + React + TypeScript project initialized
- Folder structure matches ARCHITECTURE.md
- Leaflet map renders centered on Mumbai (19.0760° N, 72.8777° E), zoom 10
- Axios instance configured in `src/services/api.ts` with base URL from `VITE_API_BASE_URL` env var
- `.env.example` with `VITE_API_BASE_URL=http://localhost:8000`
- No unused boilerplate (remove default Vite CSS, SVG, App.css)
- TypeScript strict mode enabled

**Files to create:**
```
frontend/src/services/api.ts
frontend/src/maps/BaseMap.tsx
frontend/src/pages/Home.tsx
frontend/src/types/common.ts       ← BBox, DateRange interfaces
frontend/src/types/heatmap.ts      ← HeatmapRequest, HeatmapResponse interfaces
.env.example
```

---

### TASK-005 — Heatmap Integration (End-to-End)
**Status:** Not started
**Blocked by:** TASK-003 + TASK-004

**Acceptance criteria:**
- `useHeatmapData(bbox)` hook in `src/hooks/useHeatmapData.ts`
- Hook calls `heatmapService.fetchHeatmap()` on bbox change
- Hook returns `{tileUrl, stats, loading, error}`
- `HeatmapLayer` component consumes hook and adds Leaflet `TileLayer` when tileUrl is available
- Map pans and fits bounds to the bbox automatically on load
- Loading spinner shown while fetching
- Error card shown if API fails
- Hardcoded bbox: Mumbai [72.77, 18.89, 72.99, 19.27]

**Files to create:**
```
frontend/src/hooks/useHeatmapData.ts
frontend/src/services/heatmapService.ts
frontend/src/maps/HeatmapLayer.tsx
frontend/src/components/LoadingSpinner.tsx
frontend/src/components/ErrorCard.tsx
```

---

## Sprint 2 — Location Search + User Input

### TASK-006 — City Search via Nominatim
**Status:** Not started
**Acceptance criteria:**
- Search input with 300ms debounce
- Calls Nominatim: `https://nominatim.openstreetmap.org/search?q={city}&format=json&limit=5`
- Returns: city name + bounding box `[south, north, west, east]` (convert to our `[minLon, minLat, maxLon, maxLat]` format)
- Dropdown shows up to 5 results
- On select: updates MapContext bbox → triggers heatmap refetch
- User-Agent header set in request (Nominatim policy)
- No more than 1 request/second (debounce handles this)

### TASK-007 — Date Range Selector
**Status:** Not started
**Acceptance criteria:**
- Start date + end date pickers (HTML date inputs for MVP)
- Default: last 30 days
- Validation: end > start, start not before 2001-01-01 (MODIS launch), range ≤ 365 days
- On change: re-fetches heatmap with new date range
- Date state lives in MapContext alongside bbox

### TASK-008 — Caching Layer Hardening
**Status:** Not started
**Acceptance criteria:**
- Cache hit/miss logged with cache key prefix
- TTL enforced correctly for heatmap (6hr) vs timeseries (24hr)
- Cache key normalization: bbox floats rounded to 4 decimal places before hashing
- Cache stats endpoint: `GET /api/cache/stats` returns `{hit_count, miss_count, entry_count}`

---

## Upcoming: Sprint 3 — Temporal Analysis + Hotspots

### TASK-009 — /api/timeseries Endpoint
**Status:** Upcoming
**Acceptance criteria:**
- `GET /api/timeseries?bbox=...&start=...&end=...`
- Returns monthly mean LST for the bbox over the date range
- Format: `{dates: ["2023-01", ...], mean_lst: [28.3, ...], max_lst: [34.1, ...]}`
- Frontend: Recharts `<LineChart>` with dual lines (mean + max)
- Time slider to scrub through dates

### TASK-010 — /api/hotspots Endpoint
**Status:** Upcoming
**Acceptance criteria:**
- `GET /api/hotspots?bbox=...&date=...&top_n=10`
- Threshold: pixels > mean LST + 2 standard deviations
- Returns GeoJSON FeatureCollection with top N hotspot centroids
- Each feature has properties: `{rank, mean_temp, severity: "high"|"extreme"}`
- Frontend: Leaflet CircleMarker per hotspot, colored by severity

### TASK-011 — /api/landuse Endpoint
**Status:** Upcoming
**Acceptance criteria:**
- `GET /api/landuse?bbox=...&date=...`
- Uses Dynamic World v1, dominant class per cell
- Returns GeoJSON with class labels + colors
- Frontend: semi-transparent overlay layer, toggleable

---

## Backlog (Sprint 4+)

### Deployment
- [ ] Frontend: deploy to Vercel, connect `VITE_API_BASE_URL` to production backend URL
- [ ] Backend: deploy to Render, configure env vars, test cold start behavior
- [ ] UptimeRobot ping `/health` every 10 min to prevent Render spin-down

### Production Hardening
- [ ] Rate limiting: slowapi, 10 req/min/IP (configurable via env)
- [ ] Global React error boundary
- [ ] Loading skeletons (not just spinners)
- [ ] Responsive design (mobile-usable map)
- [ ] GitHub Actions: lint + type check on PR

### v2 — Prediction Module
- [ ] `/api/predict` — linear regression on 5-year MODIS LST history per bbox cluster
- [ ] Confidence intervals displayed on prediction chart
- [ ] Explicit disclaimer UI: "Statistical projection — not a climate model"

### v2 — Mitigation Module
- [ ] `/api/suggest-mitigation` — rule-based suggestions per hotspot class
- [ ] NDVI correlation: identify low-vegetation high-heat zones
- [ ] Mitigation cards per hotspot (tree planting, reflective surfaces, water bodies)

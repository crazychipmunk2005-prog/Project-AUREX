# System Architecture

---

## 1. Layer Definitions

### Layer 1 — Frontend (React / Vite)
**Owns:**
- All user input (location search, date range, layer toggles)
- Map rendering (Leaflet + GEE tile URL overlays)
- Chart rendering (Recharts)
- Loading / error / empty states
- API orchestration (calling backend services via /services)

**Does NOT own:**
- GEE logic of any kind
- Data transformation beyond display formatting (rounding, labels)
- Business logic — that belongs in backend services

---

### Layer 2 — Backend (FastAPI)
**Owns:**
- Request validation (Pydantic models — all inputs validated before GEE is touched)
- Caching (Redis in prod, in-memory dict in dev)
- GEE service orchestration (calls services/gee_service.py)
- Standardized error responses
- Rate limiting (slowapi middleware)
- Secret management (env vars, never in code)

**Does NOT own:**
- UI logic
- Pixel data storage (raw tiles never touch the backend)
- Serving map tiles (GEE tile servers handle this directly)

---

### Layer 3 — Google Earth Engine
**Owns:**
- All satellite data computation
- LST calculation + scale factor conversion
- NDVI computation
- Spatial statistics (reduceRegion, zonal stats)
- Tile URL generation (getMapId)
- Actual tile serving to Leaflet

**Does NOT own:**
- User session management
- Caching
- Input validation

---

## 2. Data Flow Patterns

There are exactly two data flow patterns in this system.
Every GEE feature fits into one of them. Do not invent a third.

---

### Pattern A — Tile Flow (for map visualization)

Used by: `/api/heatmap`, `/api/landuse`

```
[Browser]
   │
   ├─1─► POST /api/heatmap  {bbox, start_date, end_date}
   │         │
   │         ├── Pydantic validation (bbox area, date format, range)
   │         ├── Cache check → HIT: return cached tile_url immediately
   │         │                 MISS: continue
   │         │
   │         └── asyncio.to_thread(gee_service.get_lst_tile, bbox, dates)
   │                   │
   │                   └── ee.Image(MODIS MOD11A2)
   │                         .filterDate(start, end)
   │                         .filterBounds(roi)
   │                         .select('LST_Day_1km')
   │                         .mean()
   │                         .multiply(0.02).subtract(273.15)   ← Celsius
   │                         .getMapId({palette: [...]})
   │                         → returns {tile_url, token}
   │
   ├─2─◄ Response: {success, data: {tile_url, stats}, cached}
   │
   └─3─► Leaflet: L.tileLayer(tile_url).addTo(map)
              │
              └─► Tiles rendered: [Browser] ◄──────────────── [GEE Tile Servers]
                                             (direct connection — zero backend load)
```

**Key rule:** Pixel data never passes through FastAPI. Only the tile URL does.

---

### Pattern B — Statistics Flow (for charts and ranked data)

Used by: `/api/timeseries`, `/api/hotspots`

```
[Browser]
   │
   ├─1─► GET /api/timeseries  ?bbox=...&start=...&end=...
   │         │
   │         ├── Pydantic validation
   │         ├── Cache check → HIT / MISS
   │         │
   │         └── asyncio.to_thread(gee_service.get_lst_timeseries, ...)
   │                   │
   │                   └── ee.ImageCollection(MODIS)
   │                         .filterDate().filterBounds()
   │                         .map(scale_to_celsius)
   │                         .map(lambda img: img.reduceRegion(
   │                               reducer=ee.Reducer.mean(),
   │                               geometry=roi,
   │                               scale=1000
   │                         ))
   │                         → returns list of {date, mean_lst}
   │
   ├─2─◄ Response: {success, data: {dates: [...], values: [...]}, cached}
   │
   └─3─► Recharts <LineChart> renders the timeseries
```

**Key rule:** Only aggregated statistics travel through the backend. No pixel arrays.

---

## 3. Caching Architecture

### Cache Key Format
```
{endpoint}:{sha256(bbox_normalized + start_date + end_date + extra_params)}
```

Always normalize bbox coordinates before hashing (round to 4 decimal places)
to prevent cache misses from floating point noise.

### TTL Policy
| Endpoint | TTL | Rationale |
|----------|-----|-----------|
| /api/heatmap | 6 hours | MODIS composites update every 8 days |
| /api/timeseries | 24 hours | Historical data is immutable |
| /api/hotspots | 6 hours | Derived from heatmap — same freshness |
| /api/landuse | 24 hours | Land classification changes on timescale of months |

### Cache Implementation
```python
# Development (no Redis required)
_cache: dict[str, tuple[Any, float]] = {}   # {key: (value, expiry_timestamp)}

# Production — identical interface, Redis backend
# Drop-in swap: set REDIS_URL in .env, cache module detects and switches
```

---

## 4. GEE Dataset Reference

### Primary: MODIS MOD11A2
```python
collection_id = "MODIS/061/MOD11A2"
band          = "LST_Day_1km"
scale_factor  = 0.02      # multiply raw value
offset        = -273.15   # subtract to get Celsius
resolution    = 1000      # meters — use scale=1000 in reduceRegion
```

### NDVI: MODIS MOD13A2
```python
collection_id = "MODIS/061/MOD13A2"
band          = "NDVI"
scale_factor  = 0.0001
resolution    = 500
```

### Land Use: Dynamic World v1
```python
collection_id = "GOOGLE/DYNAMICWORLD/V1"
band          = "label"   # dominant class per pixel
classes       = {0: "water", 1: "trees", 2: "grass", 3: "flooded_vegetation",
                 4: "crops", 5: "shrub_and_scrub", 6: "built", 7: "bare", 8: "snow_and_ice"}
resolution    = 10
```

### Landsat 8/9 LST (hotspot drill-down only — v2)
Do not use in MVP. Cloud masking adds significant complexity.
Use MODIS for all v1 features.

---

## 5. Bounding Box Rules

All bbox validation runs in Pydantic before any GEE call.

```
Format:  [min_lon, min_lat, max_lon, max_lat]  (WGS84)
Max area: 50,000 km²   (~225 × 225 km — covers any major city generously)
Min area: 1 km²        (prevent degenerate point queries)
```

Why 50,000 km²: Larger areas cause GEE `User memory limit exceeded` errors on the free tier.
This is enforced as a hard 422 validation error, not a soft warning.

---

## 6. Error Handling Architecture

```
GEE SDK throws ee.EEException
    └─► gee_service.py catches → raises GEEServiceError(code, detail)

FastAPI route handler catches GEEServiceError
    └─► returns HTTP 503 with standard error envelope

Pydantic validation fails
    └─► FastAPI returns HTTP 422 automatically

Any unhandled exception
    └─► global exception handler → HTTP 500 with generic message
        (never expose internal stack traces to client)

Frontend
    └─► All API calls in /services have try/catch
        └─► Errors propagate to component error state
            └─► User sees an error card, never a white crash screen
```

### Standard Error Envelope
```json
{
  "success": false,
  "data": null,
  "error": "Human-readable description of what went wrong",
  "cached": false
}
```

---

## 7. Security Architecture

| Concern | Mechanism |
|---------|-----------|
| GEE credentials | Service account key file, path in .env, file in gitignored /secrets |
| Frontend API calls | Backend URL only — no GEE keys ever in frontend |
| Input validation | Pydantic models on all endpoints — strict type coercion |
| Rate limiting | slowapi: 10 requests/minute per IP (configurable via .env) |
| CORS | Explicit origin whitelist — never `allow_origins=["*"]` in production |
| .env files | .env.example committed, actual .env gitignored |

---

## 8. Deployment Architecture

```
Frontend  →  Vercel  (static hosting, automatic deploys from main branch)
Backend   →  Render / Railway  (Python container)

Environment variables set via platform UI — never in code or committed files.

Cold start mitigation (Render free tier spins down after 15 min inactivity):
  Option A: Upgrade to paid tier ($7/mo)
  Option B: UptimeRobot pings /health every 10 minutes (free)
  Option C: Accept cold start — add a loading message: "Waking up server..."
```

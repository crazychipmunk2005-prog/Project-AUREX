# Urban Heat Island Analysis Platform

## Project Overview
A production-grade web platform for analyzing, visualizing, and predicting Urban Heat Islands (UHI)
using satellite-derived Land Surface Temperature (LST) data via Google Earth Engine.

> **Terminology note:** Data is fetched *on-demand*, not "real-time".
> GEE's most recent MODIS data has a minimum 1–2 day latency. UI language must reflect this.

---

## Tech Stack

### Frontend
| Tool | Purpose |
|------|---------|
| React 18 (Vite) | UI framework |
| TypeScript | Type safety |
| Leaflet + react-leaflet | Map rendering + GEE tile overlay |
| Recharts | Temporal trend graphs |
| Axios | HTTP client |
| OpenStreetMap Nominatim | Geocoding (free, no API key) |

### Backend
| Tool | Purpose |
|------|---------|
| Python 3.11 | Runtime |
| FastAPI | API framework |
| earthengine-api | GEE Python client |
| Pydantic v2 | Validation + settings |
| slowapi | Rate limiting |
| Redis / in-memory dict | Caching (prod / dev) |

### Data Sources
| Dataset | Use Case | Resolution | Revisit |
|---------|----------|------------|---------|
| MODIS MOD11A2 | LST — primary | 1 km | 8-day |
| Landsat 8/9 Collection 2 | LST — hotspot drill-down only | 30 m | 16-day |
| MODIS MOD13A2 | NDVI / vegetation index | 500 m | 8-day |
| Dynamic World v1 | Land use classification | 10 m | Near-daily |

---

## Architecture
See `docs/ARCHITECTURE.md` for the full breakdown.

```
User
 └─► React Frontend
      └─► FastAPI Backend  (validation · caching · orchestration)
           └─► GEE Python Client  (all computation)
                ├─► GEE Tile Servers  ──────────────────► Leaflet (tiles)
                └─► GEE Computed Stats (JSON) ──► Backend ──► Frontend (charts)
```

Pixel data **never** passes through the backend. Only tile URLs and statistical summaries do.

---

## MVP Scope (v1.0) — Features 1–4 only

- [ ] Location selection (city search → bounding box)
- [ ] LST heatmap (MODIS MOD11A2, tile-based via Leaflet)
- [ ] Temporal analysis (monthly LST trend — line chart)
- [ ] Hotspot detection (ranked zones above statistical threshold)
- [ ] Land use overlay (Dynamic World classification)

**Out of scope for v1.0 — deferred to v2.0:**
- ML-based heat prediction
- Mitigation strategy simulation
- Cooling impact modeling
- Urban planning insight engine

Rationale for deferral: see `docs/DECISIONS.md` → ADR-007.

---

## Environment Variables

```env
# Backend (.env)
GEE_PROJECT_ID=your-gee-project
GEE_SERVICE_ACCOUNT=your-sa@project.iam.gserviceaccount.com
GEE_KEY_FILE=secrets/gee-key.json
REDIS_URL=redis://localhost:6379          # optional; falls back to in-memory
ALLOWED_ORIGINS=http://localhost:5173
RATE_LIMIT=10/minute

# Frontend (.env)
VITE_API_BASE_URL=http://localhost:8000
```

---

## Folder Structure

```
/
├── frontend/
│   └── src/
│       ├── components/     # Stateless UI components only
│       ├── pages/          # Route-level page components
│       ├── services/       # All axios API call logic
│       ├── maps/           # Map-specific components (BaseMap, HeatLayer, etc.)
│       ├── hooks/          # Custom React hooks (useHeatmap, useTimeseries, etc.)
│       ├── context/        # React Contexts (MapContext, etc.)
│       ├── types/          # TypeScript interfaces + API response shapes
│       └── utils/          # Pure helper functions
│
├── backend/
│   ├── routes/             # FastAPI routers — endpoint definitions only
│   ├── services/           # GEE logic + external integrations
│   ├── models/             # Pydantic request/response models
│   ├── utils/              # Cache, validators, helpers
│   └── config/             # pydantic-settings, GEE auth init
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CONVENTIONS.md
│   ├── CONTEXT.md
│   ├── DECISIONS.md
│   ├── TASKS.md
│   └── openapi.yaml
│
└── secrets/                # gitignored — GEE key file lives here
```

---

## Sprint Roadmap

| Sprint | Goal | Status |
|--------|------|--------|
| 1 | Skeleton + GEE auth + hardcoded heatmap tile renders | Not started |
| 2 | City search + real user input + date picker | Not started |
| 3 | Timeseries chart + hotspot detection + land use overlay | Not started |
| 4 | Caching + error states + deployment | Not started |
| v2 | ML prediction + mitigation simulation | Backlog |

---

## Prerequisites Before Sprint 1

- [ ] GEE account approved with Cloud Project + API access enabled
- [ ] Service account created with GEE Editor role
- [ ] Service account key downloaded to `secrets/gee-key.json` (never commit this)
- [ ] Python 3.11+ installed
- [ ] Node 18+ installed

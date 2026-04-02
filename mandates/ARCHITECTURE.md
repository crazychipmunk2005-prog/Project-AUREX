# System Architecture (Static-First)

---

## 0. Architectural Direction (Authoritative)

The platform is now **static-first**.

- No live Google Earth Engine (GEE) calls at runtime.
- All satellite processing is done offline, exported once, and hosted as static assets.
- Runtime map rendering uses TiTiler + COGs only.

This supersedes prior runtime-GEE flow for v1 portfolio delivery.

---

## 1. Layer Definitions

### Layer 1 — Frontend (React / Vite / Leaflet)
**Owns:**
- User input: city selector, metric selector, timeline slider (2019-01 to 2024-12)
- Map rendering with Leaflet TileLayer
- Tile URL parameter orchestration (`bidx`, `rescale`, `colormap`)
- Lightweight UI-only formatting (labels, legends, loading states)

**Does NOT own:**
- Raster computation
- Satellite preprocessing
- Credential signing logic

---

### Layer 2 — Tile API (TiTiler)
**Owns:**
- Reading Cloud-Optimized GeoTIFFs (COGs) via HTTPS URL
- Serving XYZ tiles for requested zoom/x/y
- Applying band selection and visualization params per request

**Does NOT own:**
- Satellite science/business logic
- Data preprocessing
- User session state

---

### Layer 3 — Static Storage (Cloudflare R2)
**Owns:**
- Long-lived storage of final COG assets and metadata JSON
- Public read access for TiTiler input URLs
- Immutable caching headers for stable delivery

**Does NOT own:**
- Tile rendering
- Geospatial computation

---

### Layer 4 — Offline Data Pipeline (One-time / batch)
**Owns:**
- GEE export of monthly composites (LST, NDVI)
- Data normalization and COG optimization (if required)
- Optional precomputed stats/metadata generation

**Does NOT own:**
- Runtime request handling
- Interactive UI state

---

## 2. Runtime Data Flow

### Pattern A — Raster Tile Flow (primary interaction)

Used by: timeline slider + metric toggle + city selection

```
[Browser / React + Leaflet]
   │
   ├─ User picks city + metric + month step (1..72)
   │
   ├─ Build TiTiler URL:
   │   /cog/tiles/{z}/{x}/{y}?url=<cog_url>&bidx=<band>&rescale=<min,max>&colormap_name=<name>
   │
   ├─► TiTiler reads COG from Cloudflare R2
   │
   └─◄ PNG/WebP tiles rendered in Leaflet
```

**Key rule:** Runtime never calls GEE.

---

### Pattern B — Metadata Flow (supporting UI)

Used by: timeline labels, city extents, legend config

```
[Browser]
   ├─► GET static metadata JSON (R2 or frontend public assets)
   └─◄ timeline index, extents, visualization presets
```

---

## 3. Offline Data Pipeline Flow

```
Google Earth Engine (batch export)
    └─► GeoTIFF outputs (monthly stacks)
         └─► Local QC / COG validation
              └─► Upload to Cloudflare R2
                   └─► TiTiler consumes by URL at runtime
```

### Export scope (locked)
- Cities: Chennai, Bengaluru, Delhi
- Metrics: LST and NDVI
- Timeline: 2019-01 to 2024-12 (72 monthly steps)
- Preferred asset shape: one 72-band COG per city per metric

---

## 4. Asset Model

### Required naming convention
`aurex_<city>_<metric>_2019_2024_monthly_stack_v1.tif`

### Required folder structure
```
aurex-data/
  v1/
    cities/
      chennai/
        lst/
          aurex_chennai_lst_2019_2024_monthly_stack_v1.tif
        ndvi/
          aurex_chennai_ndvi_2019_2024_monthly_stack_v1.tif
      bengaluru/
        lst/
          aurex_bengaluru_lst_2019_2024_monthly_stack_v1.tif
        ndvi/
          aurex_bengaluru_ndvi_2019_2024_monthly_stack_v1.tif
      delhi/
        lst/
          aurex_delhi_lst_2019_2024_monthly_stack_v1.tif
        ndvi/
          aurex_delhi_ndvi_2019_2024_monthly_stack_v1.tif
    metadata/
      timeline_index.json
      color_scales.json
      cities_extent.geojson
```

---

## 5. Runtime Service Boundaries

### Frontend hosting
- Vercel or Netlify free tier

### Tile API hosting
- Render free tier (TiTiler)

### Storage
- Cloudflare R2 free tier (public read objects)

### Optional backend policy
- If FastAPI remains, it must not be required for map tile rendering.
- Keep it only for health/status or future lightweight APIs.

---

## 6. Performance and Reliability Rules

1. COG assets must be immutable versioned files (`v1`, `v2`, ...).
2. Frontend should cache tile URL templates per city+metric+band state.
3. R2 objects must send long cache headers (`max-age=31536000, immutable`).
4. TiTiler service should run single-worker on free tier to minimize memory pressure.
5. Expect and design for free-tier cold starts; show non-blocking loading states.

---

## 7. Security Rules (Static Architecture)

1. No secret keys in frontend.
2. R2 write credentials remain private; frontend uses read-only public URLs only.
3. CORS allowlists must include only deployed frontend origins.
4. `.env` and `secrets/` stay gitignored.

---

## 8. Non-Negotiable Rules (v1 Static)

1. Runtime GEE calls are prohibited.
2. Monthly timeline must map deterministically to band index 1..72.
3. Visualization ranges are fixed per metric and documented.
4. City extents are bounded and explicit (no global/unbounded requests).
5. Any architecture change requires a new ADR entry in `DECISIONS.md`.

---

## 9. Known Free-Tier Constraints

- Render may cold start after idle.
- TiTiler throughput is limited on free instances.
- R2 request/egress quotas are finite (usually fine for portfolio traffic).
- Frontend monthly bandwidth/build minutes are limited.

Design expectation: occasional first-request latency is acceptable; system must remain functional without manual maintenance.

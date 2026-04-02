# Sprint Tasks

> This is the single source of truth for active development work.

---

## Active Sprint: Static Sprint 1 — Data + Tile Foundation

**Sprint Goal:**
Deliver a zero-maintenance static geospatial pipeline for AUREX.

**Definition of Done:**
- Offline GEE export script exists for the full west-coast context AOI
  (Kerala + Lakshadweep + contextual buffer).
- Monthly LST and NDVI stacks for 2019-2024 are exported as GeoTIFF/COG-ready outputs.
- Asset naming and folder standards are finalized and documented.
- TiTiler can read at least one exported COG and return tiles successfully.
- Frontend timeline contract is fixed to band indices 1..72.

---

### TASK-S001 — AOI + Export Script (GEE)
**Status:** Completed

**Acceptance criteria:**
- Script defines study area for Kerala/Lakshadweep/context.
- Script exports monthly stack for each metric (LST, NDVI).
- Exports cover 2019-01 to 2024-12.
- Output names follow AUREX naming convention.

---

### TASK-S002 — Static Asset Contract
**Status:** Completed

**Acceptance criteria:**
- Folder structure and file naming are documented in `ARCHITECTURE.md`.
- Timeline mapping (`band 1 -> 2019-01`, `band 72 -> 2024-12`) is locked.
- Metadata file names are fixed (`timeline_index.json`, `color_scales.json`).

---

### TASK-S003 — TiTiler Runtime Contract
**Status:** Pending

**Acceptance criteria:**
- TiTiler endpoint pattern documented and tested:
  `/cog/tiles/{z}/{x}/{y}?url=<cog_url>&bidx=<band>&rescale=<min,max>&colormap_name=<name>`
- One smoke test confirms 200 response for a valid COG URL.
- CORS allows frontend domain(s).

---

### TASK-S004 — Cloudflare R2 Setup
**Status:** Completed (temporary fallback)

**Acceptance criteria:**
- Bucket created for AUREX static data.
- Public read access configured for COG objects.
- CORS policy set for frontend domain(s).
- Cache headers set for immutable versioned assets.

**Implementation note (approved fallback):**
- Due payment-method constraints, Sprint 1 uses GitHub public raw URLs as temporary
  object hosting for COG files.
- TiTiler integration is verified against both LST and NDVI COG URLs.
- Planned upgrade path: migrate storage to R2/B2/S3 in a future hardening sprint.

---

### TASK-S005 — Frontend Timeline Integration (Static)
**Status:** Pending

**Acceptance criteria:**
- Slider controls monthly band index 1..72.
- Metric toggle switches LST/NDVI visualization params.
- City/region selector updates COG URL source.
- Leaflet TileLayer updates on slider drag without app crash.

---

## Next Sprint (Preview): Static Sprint 2 — Portfolio Hardening

- README narrative for CV/portfolio story
- Free-tier resilience notes + known limitations
- UI polish for engineering-grade dark style
- Optional backend reduction (health endpoint only)

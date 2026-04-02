# Project Context
### Feed this file to every AI coding session as a system prompt prefix.
### Always combine with CONVENTIONS.md and the specific TASK from TASKS.md.

---

## What We're Building
AUREX is a static-first Urban Heat Change Analyzer for portfolio use.
Users interact with a map timeline (2019-2024) and inspect LST/NDVI patterns.

Runtime stack is intentionally simple:
- React + Leaflet frontend
- TiTiler tile API
- Cloudflare R2 static COG storage

---

## What This Is NOT
- Not a runtime GEE app. GEE is used only for offline exports.
- Not a real-time system. Timeline is historical monthly composites.
- Not an ML project in v1.
- Not a backend-heavy architecture.

---

## Stack — Locked (v1 static)
```
Frontend : React 18 · Vite · TypeScript · Leaflet
Tile API : TiTiler (Render free tier)
Storage  : Cloudflare R2 (public read COGs)
Data     : MODIS MOD11A2 (LST) · MODIS MOD13A2 (NDVI)
Offline  : Google Earth Engine export + optional GDAL optimization
Deploy   : Vercel/Netlify (frontend) · Render (TiTiler)
```

---

## Non-Negotiable Architectural Rules

1. Runtime GEE calls are prohibited.
2. Interactive map uses TiTiler `cog/tiles` URLs only.
3. Timeline is fixed monthly steps from 2019-01 to 2024-12 (72 bands).
4. All heavy compute happens before deployment (offline export stage).
5. COG assets are immutable and versioned (`v1`, `v2`, ...).
6. Frontend must keep business logic in hooks/services, not UI components.
7. No secrets in code; write credentials never exposed to frontend.

---

## Regional Scope (Current)

Primary study area includes:
- Kerala (all districts)
- Lakshadweep
- Arabian Sea EEZ context adjacent to Kerala
- Small buffer into neighboring states for contextual continuity

---

## Folder Structure — Do Not Deviate
```
frontend/src/
  components/
  pages/
  services/
  maps/
  hooks/
  context/
  types/
  utils/

scripts/
  gee/
  data/

mandates/
  ARCHITECTURE.md
  CONTEXT.md
  CONVENTIONS.md
  DECISIONS.md
  TASKS.md
  SECURITY.md
```

---

## Security Rules — Non-Negotiable

1. `.env` and `secrets/` remain gitignored.
2. Frontend reads only public R2 URLs and TiTiler URLs.
3. R2 write keys must never be used in browser code.
4. CORS allowlist must be explicit for deployed frontend origins.

---

## Instructions for AI-Assisted Development

1. Read active task in `TASKS.md` before coding.
2. Follow `ARCHITECTURE.md`, `CONVENTIONS.md`, and `SECURITY.md`.
3. Prefer static/tile-serving patterns over backend compute logic.
4. Do not introduce runtime GEE dependencies.
5. If any rule is intentionally changed, record it in `DECISIONS.md`.

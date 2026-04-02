# Project Context
### Feed this file to every AI coding session as a system prompt prefix.
### Always combine with CONVENTIONS.md and the specific TASK from TASKS.md.

---

## What We're Building
An Urban Heat Island (UHI) analysis web platform. Users select a city, and the platform
fetches satellite Land Surface Temperature (LST) data via Google Earth Engine (GEE),
displaying heatmaps, temporal trends, hotspot rankings, and land use overlays.

---

## What This Is NOT
- Not a real-time system — GEE data has minimum 1–2 day latency. Do not use "real-time" in code comments or UI labels.
- Not storing satellite imagery locally — pixel data never passes through our backend.
- Not a deep learning project — v1 has no ML. v2 uses linear regression only.
- Not a research tool that requires scientific rigor beyond what's described here.

---

## Stack — Locked. Do not suggest alternatives without a DECISIONS.md entry.
```
Frontend : React 18 · Vite · TypeScript · Leaflet · Recharts · Axios
Backend  : Python 3.11 · FastAPI · earthengine-api · Pydantic v2 · slowapi
Cache    : Redis (prod) · in-memory dict (dev)
Data     : MODIS MOD11A2 (LST) · Dynamic World v1 (land use) · MODIS MOD13A2 (NDVI)
Deploy   : Vercel (frontend) · Render/Railway (backend)
```

---

## Non-Negotiable Architectural Rules

1. **GEE tile URLs go directly to Leaflet** — never proxy tile pixels through FastAPI.
2. **GEE calls always filter by bbox AND date** — never fetch global or unconstrained datasets.
3. **All GEE logic lives in `backend/services/` only** — never in routes, utils, or models.
4. **No business logic in React components** — all in hooks or services.
5. **All API responses use the standard envelope:**
   ```json
   { "success": true, "data": {...}, "error": null, "cached": false }
   ```
6. **All GEE calls are wrapped in** `asyncio.to_thread()` inside async FastAPI handlers.
7. **All inputs validated with Pydantic** before GEE is called.
8. **Max bbox area: 50,000 km²** — enforced as a hard validation error.
9. **MODIS MOD11A2 is the primary LST source** — do not substitute Landsat in v1.
10. **No API keys, credentials, or secrets in any code file** — env vars only.

---

## Folder Structure — Do Not Deviate
```
frontend/src/
  components/     Stateless UI components only
  pages/          Route-level pages
  services/       All axios API call logic
  maps/           Map-specific components
  hooks/          Custom React hooks
  context/        React Contexts
  types/          TypeScript interfaces
  utils/          Pure helper functions

backend/
  routes/         FastAPI routers (endpoint definitions only — no logic)
  services/       GEE logic and external service calls
  models/         Pydantic request/response models
  utils/          Cache, validators, custom exceptions
  config/         pydantic-settings, GEE auth initialization
```

---

## Current Sprint
See `TASKS.md` for active task definitions and acceptance criteria.

---

## Security Rules — Non-Negotiable (Read SECURITY.md for full detail)

These apply to every line of code generated for this project.
Violation of any of these is grounds to reject generated code and request a rewrite.

**SEC-01 — No secrets in code.**
No API keys, service account paths, tokens, passwords, or credentials in any .py or .ts file.
All secrets come from environment variables via pydantic-settings (backend) or import.meta.env (frontend).

**SEC-02 — HTTPS only in production.**
All `VITE_API_BASE_URL` values in production use `https://`. HTTPSRedirectMiddleware active in production.

**SEC-03 — All routes require API key authentication.**
Every FastAPI route (except /health) uses `Depends(verify_api_key)`.
Frontend Axios instance always sends `X-API-Key` header.

**SEC-04 — All inputs validated before any downstream call.**
Pydantic models validate every field. GEE is never called with unvalidated input.
Request body size capped at 10KB via middleware.

**SEC-05 — Error responses never expose internals.**
All exceptions caught by global handler. Client receives only `safe_message`.
Stack traces go to server logs only — never to HTTP responses.

**SEC-06 — No sensitive data in logs.**
Logging middleware strips: api keys, auth headers, full request bodies.
Logs contain: path, method, status code, duration — nothing more at INFO level.

**SEC-07 — Security headers on all responses.**
SecurityHeadersMiddleware applied in main.py. X-Frame-Options, X-Content-Type-Options,
HSTS (production), Referrer-Policy all set.

**SEC-08 — CORS uses explicit origin whitelist.**
`allow_origins` reads from `ALLOWED_ORIGINS` env var. Never `["*"]` in production.

**SEC-09 — GEE tile cache TTL ≤ 3 hours.**
GEE tile URL tokens expire at ~4 hours. Cache TTL for tile endpoints is 3 hours maximum.

**SEC-10 — .gitignore must pre-exist any secret files.**
.gitignore is the first committed file. `secrets/`, `.env`, `*.json` are gitignored.

---

## Instructions for AI-Assisted Development

When generating code for this project:

1. Read the active task in TASKS.md first — understand the acceptance criteria before writing a line.
2. Follow CONVENTIONS.md and SECURITY.md exactly.
3. Do not introduce dependencies not already in the stack without flagging it explicitly.
4. Do not restructure folders or rename existing files.
5. Do not add abstractions (base classes, factories, registries) not already in ARCHITECTURE.md.
6. If a task is ambiguous, state the ambiguity and your assumed interpretation before proceeding.
7. If you generate code that deviates from a rule above, explicitly note the deviation and why.
8. Generated code must be complete and runnable — no placeholder comments like `# implement this`.
9. All generated Python functions must have type hints.
10. All generated TypeScript must have interfaces for props and API response shapes.
11. Every generated FastAPI route must include `Depends(verify_api_key)` unless it is /health.
12. Every generated service function must wrap external calls in try/except and raise typed exceptions.
13. Never generate code that logs request bodies, query parameters containing coordinates, or auth headers.

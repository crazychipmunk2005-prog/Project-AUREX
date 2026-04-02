# Architecture Decision Records (ADRs)

> Every significant architectural choice is documented here.
> Before changing a decision, add a new ADR superseding the old one — don't delete history.
> Format: Decision → Context → Rationale → Trade-offs → Alternatives Rejected

---

## ADR-001: MODIS MOD11A2 as primary LST source

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Use MODIS MOD11A2 (`LST_Day_1km`) for all heatmap, temporal, and hotspot features in v1.

**Context:**
Multiple GEE datasets provide LST. The two main candidates were MODIS (1km) and Landsat 8/9 (30m).

**Rationale:**
- MODIS provides 8-day composites with near-global coverage and minimal cloud masking issues
- Landsat has 16-day revisit cadence, significant cloud contamination, and requires multi-step QA band masking
- 1km resolution is sufficient for city-scale UHI detection, hotspot ranking, and temporal trends
- MODIS dramatically reduces GEE computation time (~3–8s vs ~15–40s for Landsat) and quota usage

**Trade-offs:**
- Small-scale hotspots (<1km features like individual rooftops) are not detectable
- Academic papers use Landsat for high-res UHI studies — this platform is not a research instrument

**Alternatives rejected:**
- Landsat 8/9 as primary — adds cloud masking complexity that would consume an entire sprint
- Sentinel-3 LST — lower data availability outside Europe, more complex GEE access

---

## ADR-002: GEE tile URLs served directly to Leaflet (not proxied)

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Backend returns a GEE tile URL template string. Frontend Leaflet renders tiles directly
from GEE's tile servers. Pixel data never passes through the FastAPI backend.

**Context:**
Two patterns exist for serving GEE map tiles:
- Option A: Backend proxies every tile request (backend fetches tile, returns to browser)
- Option B: Backend returns tile URL, browser fetches tiles directly from GEE

**Rationale:**
- Option A would route hundreds of tile requests through FastAPI, destroying free-tier memory/bandwidth limits
- Option B means zero pixel bandwidth through our backend for map display
- GEE tile URLs (from `getMapId()`) include an authentication token — they're not guessable public URLs
- Token expiry (~4 hours) is acceptable for session-length map usage

**Trade-offs:**
- Tile URLs expire after ~4 hours. Long sessions may require a `/api/refresh-tile` endpoint (noted for v2).
- Browser devtools will show GEE URLs — this is acceptable; tokens are ephemeral

**Alternatives rejected:**
- Proxying tiles — eliminates free-tier viability entirely

---

## ADR-003: Leaflet over Mapbox or Google Maps

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Use Leaflet with OpenStreetMap tiles as the map basemap.

**Context:**
Three realistic options: Leaflet (free), Mapbox (freemium with API key), Google Maps (metered).

**Rationale:**
- Leaflet is free, open-source, and requires no API key for OSM basemap
- GEE tile overlays (`L.tileLayer`) work identically on Leaflet vs Mapbox
- Avoids API key management and cost risk in production
- For a UHI platform, the basemap is largely hidden under the heatmap overlay — aesthetics matter less

**Trade-offs:**
- Default OSM tiles are less polished visually than Mapbox
- No built-in geocoding (mitigated by Nominatim — see ADR-005)

**Alternatives rejected:**
- Mapbox — cost risk, requires API key management
- Google Maps JavaScript API — cost risk, stricter usage terms

---

## ADR-004: React Context + useState over Redux

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Use React Context and useState for all state management in v1. No Redux or Zustand.

**Context:**
The app has two main state domains: map state (bbox, active layers, date range) and API state (loading, error, data per endpoint).

**Rationale:**
- Context + custom hooks handle these two domains cleanly without boilerplate
- Redux adds substantial setup cost that would slow MVP delivery
- API state is managed per-hook (`useHeatmapData`, `useTimeseries`) — no global store needed

**Trade-offs:**
- If feature count grows significantly in v2, Context may become unwieldy
- Mitigation path: migrate to Zustand (minimal boilerplate, hooks-native) if needed in v2

**Alternatives rejected:**
- Redux — excessive boilerplate for this scale
- Zustand — not needed yet; easy migration path if required

---

## ADR-005: OpenStreetMap Nominatim for geocoding

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Use Nominatim (OSM's free geocoding API) to convert city names to lat/lon bounding boxes.

**Context:**
Users type a city name — this must be converted to a geographic bounding box for GEE.

**Rationale:**
- Completely free, no API key required
- Returns `boundingbox` directly — perfectly suited for our bbox-first architecture
- Sufficient accuracy for city-level queries (our only use case)
- Usage policy requires a `User-Agent` header and rate limiting (1 req/sec) — easy to implement

**Trade-offs:**
- Rate limit of 1 req/sec (mitigated by 300ms debounce on input + frontend caching)
- Less accurate for ambiguous city names vs Google Places

**Alternatives rejected:**
- Google Places API — requires API key, metered
- Mapbox Geocoding — requires API key

---

## ADR-006: Max bbox area of 50,000 km² enforced at validation

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Reject any request where the bounding box area exceeds 50,000 km² with an HTTP 422 error.

**Context:**
GEE computations over large geographic areas hit memory limits and return errors or time out.

**Rationale:**
- 50,000 km² (~225 × 225 km) generously covers any city and its metropolitan area
- Areas larger than this reliably cause `User memory limit exceeded` on GEE free tier
- Enforcing at Pydantic validation level prevents quota waste before GEE is ever called
- Error message guides users: "Area too large. Select a smaller region."

**Trade-offs:**
- Country or regional analysis is not possible (this platform is not designed for it)

---

## ADR-007: ML heat prediction deferred to v2

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
No machine learning or statistical prediction features in v1.0.

**Context:**
The original project spec included "future heat prediction" as a core feature.

**Rationale:**
A scientifically valid prediction model requires:
- A defined training dataset (5+ years of MODIS history per location)
- A validation methodology (hold-out period, RMSE reporting)
- Honest uncertainty quantification (confidence intervals on predictions)
- User-facing language that accurately conveys prediction limitations

Building a "basic ML" prediction without this methodology produces misleading outputs.
A tool that tells a city planner "this area will be 3°C hotter in 2030" without validation
is worse than no prediction at all — it erodes trust and could influence real decisions.

**v2 plan:**
- Linear regression on per-cluster MODIS LST timeseries (5-year history)
- scikit-learn only — no deep learning
- Confidence intervals shown on all predictions
- Explicit disclaimer: "Statistical projection, not a climate model"

**Alternatives rejected:**
- "Basic ML" in v1 — scientifically indefensible without proper methodology

---

## ADR-008: asyncio.to_thread() for GEE synchronous calls

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
All synchronous GEE SDK calls inside FastAPI async handlers are wrapped with `asyncio.to_thread()`.

**Context:**
GEE's Python client (`earthengine-api`) is synchronous. FastAPI uses an async event loop.
Calling synchronous blocking I/O inside an async handler blocks the entire event loop.

**Rationale:**
- `asyncio.to_thread()` offloads the sync call to a thread pool without blocking the event loop
- Simpler than the alternative (Celery task queue) for MVP-scale concurrency
- Python's default thread pool is sufficient for the expected request volume

**Trade-offs:**
- Under very high concurrency (100+ simultaneous GEE requests), thread pool exhaustion is possible
- Production mitigation path: Celery + Redis task queue (documented, not implemented in v1)

---

## ADR-010: Internal API key for frontend ↔ backend authentication

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Use a shared internal API key (`X-API-Key` header) for all frontend-to-backend requests.
No user authentication system in v1.

**Context:**
The backend API is publicly addressable. Without any authentication, it is open to automated
abuse that would exhaust GEE quota.

**Rationale:**
- Full user auth (OAuth, JWT, sessions) adds 1–2 sprints of complexity not warranted for MVP
- An internal API key stops bot abuse and unauthorized consumption of GEE quota
- The key is embedded in the Vite frontend bundle (visible in devtools) — acceptable because
  it only grants access to our own API, and rate limiting caps any abuse that does occur
- GEE credentials remain server-side and are never accessible from the frontend regardless

**Trade-offs:**
- The key is technically extractable from the browser — not a secret in the cryptographic sense
- Anyone who reads the bundle could call our API directly
- Mitigated by: rate limiting (10 req/min/IP), GEE quota monitoring, key rotation if abused

**Alternatives rejected:**
- No auth at all — too easily abused
- JWT/OAuth — excessive complexity for v1 scope
- IP allowlisting — impractical for a public-facing platform

---

## ADR-011: GEE tile cache TTL set to 3 hours (not 6)

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Heatmap and hotspot tile URL cache TTL is 3 hours, not 6.

**Context:**
GEE tile URLs generated by `getMapId()` contain an authentication token that expires
after approximately 4 hours. Original TTL was set to 6 hours without accounting for this.

**Rationale:**
- A cached tile URL served after its token expires causes Leaflet to silently fail —
  tiles stop loading with no error message, which is a confusing UX failure
- 3 hours provides a safe buffer below the ~4 hour GEE token lifespan
- Timeseries and land use cache TTLs remain at 24 hours — they return statistics and
  GeoJSON, not tile URLs with tokens, so expiry is not a concern

**Alternatives rejected:**
- 6 hours — risks serving expired tokens in the second half of the cache window
- Storing token expiry alongside the URL and checking it at serve time — more complex,
  deferred to v2 token refresh endpoint

---

## ADR-009: In-memory dict cache for development, Redis for production

**Status:** Accepted
**Date:** Sprint 0

**Decision:**
Cache implementation has two modes: in-memory Python dict (dev) and Redis (prod).
The same interface (`cache.get(key)`, `cache.set(key, value, ttl)`) is used for both.

**Context:**
GEE calls are expensive (3–30 seconds). Caching is essential for usability.

**Rationale:**
- In-memory cache works in dev with zero infrastructure setup
- Redis is production-grade, survives restarts, and is available free on Render/Railway
- Shared interface means swapping is a one-line config change (`REDIS_URL` env var present/absent)

**Trade-offs:**
- In-memory cache is per-process — multiple workers in prod would each have separate caches
- Mitigation: Redis in prod ensures all workers share one cache

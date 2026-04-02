# Performance & Memory Optimization Standard — Project AUREX

> Feed this file to every AI coding session alongside CONTEXT.md, CONVENTIONS.md, and SECURITY.md.
> Rules in this document are binding. Deviations require an entry in DECISIONS.md.
> Where this document conflicts with DECISIONS.md, DECISIONS.md wins — it holds the most recent
> authoritative record of every architectural choice.

---

## Core Philosophy: The Backend Is a Relay, Not an Engine

The backend runs in a 512MB free-tier container. It does not compute spatial data. It does not
hold pixel data. It does not build large in-memory structures. Every byte that passes through
FastAPI must have a direct and necessary role in constructing the HTTP response.

All heavy computation belongs to Google Earth Engine. The backend's job is to validate the
request, check the cache, ask GEE the right question, and relay the answer. This division
is non-negotiable. Every performance rule in this document follows from it.

---

## 1. Data Transfer Discipline ("The Relay Rule")

### What NEVER crosses the backend

- Raw pixel arrays, NumPy arrays, GeoTIFF data, or any raster representation of satellite imagery.
- `ee.Image` or `ee.ImageCollection` objects — these are GEE computation graphs, not serializable
  data structures. Do not pass them between functions. Do not store them. Extract the URL or stats
  and discard the object immediately.
- Tile bytes of any kind. Never call `requests.get(tile_url)` to fetch a tile and forward it.
  This would route every map tile through our backend, destroying free-tier viability.

### What IS permitted to cross the backend

- GEE tile URL strings from `getMapId()` — a short string (under 300 characters), not pixel data.
- Aggregated scalar statistics from `reduceRegion`, e.g. `{"mean_temp": 32.4, "max_temp": 39.1}`.
- GeoJSON FeatureCollections for hotspot centroids — ranked and capped server-side before return
  (see §4 for the enforced limit).
- Land use class distributions as simple key-value summaries.

### Why this works

GEE tile servers serve pixels directly to the user's Leaflet instance. FastAPI never sees a tile.
This is the primary memory protection for the entire system. It is documented in ADR-002.

---

## 2. GEE Computation Efficiency

GEE will terminate requests that exceed its memory or time budgets. These rules prevent that.

### 2.1 Filter First — Always

Apply `.filterBounds(roi)` and `.filterDate(start_date, end_date)` as the first operations
after selecting a collection. Never map or reduce an unfiltered collection. Every image
outside the spatial or temporal window wastes quota and risks timeout.

```python
# Correct — filter before touching anything
collection = (
    ee.ImageCollection("MODIS/061/MOD11A2")
    .filterDate(start_date, end_date)    # ← first
    .filterBounds(roi)                    # ← second
    .select("LST_Day_1km")
)

# Wrong — unfiltered map over global collection
collection = (
    ee.ImageCollection("MODIS/061/MOD11A2")
    .select("LST_Day_1km")
    .map(scale_to_celsius)        # operates on every image ever acquired globally
    .filterDate(start_date, end_date)
)
```

### 2.2 Cap Every ImageCollection

Always add `.limit(500)` to any `ImageCollection` before mapping over it. An unbounded
collection spanning years of MODIS data can exhaust GEE memory before your function
returns. 500 MODIS 8-day composites covers approximately 11 years — sufficient for
any query this platform supports.

### 2.3 Always Specify `scale` in `reduceRegion`

Omitting `scale` forces GEE to infer it from the map's display resolution rather than
the dataset's native resolution. This causes massive over-sampling and reliably triggers
`User memory limit exceeded` errors.

| Dataset          | Band         | Required Scale |
|------------------|--------------|---------------|
| MODIS MOD11A2    | LST_Day_1km  | `scale=1000`  |
| MODIS MOD13A2    | NDVI         | `scale=500`   |
| Dynamic World v1 | label        | `scale=10`    |

### 2.4 `maxPixels` Is a Circuit Breaker, Not a Validator

Set `maxPixels=1e9` in all `reduceRegion` calls. This is a GEE-side safety valve that
terminates computations which are too expensive. It is NOT a substitute for bbox area
validation, and it guards against a different failure mode.

Pydantic bbox validation (max 50,000 km²) blocks clearly oversized requests before GEE
is ever called. `maxPixels` catches edge cases where a valid-sized bbox generates
unexpectedly expensive computations — for example, `reduceRegion` on 10m Dynamic World
data over a 40,000 km² region. These are separate concerns. Both must be present.

If a request passes Pydantic validation but triggers `maxPixels`, investigate the
`scale` parameter first — it is almost always the cause.

### 2.5 Never Call `.getInfo()` in a Loop

Each `.getInfo()` call is a synchronous blocking round-trip to GEE. Calling it in a
loop multiplies latency by N and burns quota. Always aggregate results with
`reduceRegion` or `reduceRegions` and call `.getInfo()` once on the final result.

```python
# Wrong — N blocking round-trips to GEE
for image in collection.toList(100).getInfo():
    stats = ee.Image(image).reduceRegion(...).getInfo()   # one GEE call per iteration

# Correct — one round-trip for all results
def extract_stats(image: ee.Image) -> ee.Feature:
    stats = image.reduceRegion(reducer=ee.Reducer.mean(), geometry=roi, scale=1000)
    return ee.Feature(None, stats.set("date", image.date().format("YYYY-MM")))

results = collection.map(extract_stats).getInfo()   # single GEE call
```

### 2.6 Discard GEE Objects Immediately After Extracting Values

`ee.Image` objects are computation graphs, not data. Once you have extracted the tile URL
or the stats dict, the image object has served its purpose and should not be stored,
returned, or passed anywhere.

```python
# Correct — extract, use, discard
def get_lst_tile(bbox: list[float], start_date: str, end_date: str) -> dict:
    roi = ee.Geometry.Rectangle(bbox)
    image = (
        ee.ImageCollection("MODIS/061/MOD11A2")
        .filterDate(start_date, end_date)
        .filterBounds(roi)
        .select("LST_Day_1km")
        .mean()
        .multiply(0.02).subtract(273.15)
    )
    tile_info = image.getMapId({"palette": ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]})
    stats = image.reduceRegion(reducer=ee.Reducer.mean(), geometry=roi, scale=1000,
                               maxPixels=1e9).getInfo()
    # image is not stored, not returned — eligible for GC immediately
    return {"tile_url": tile_info["tile_fetcher"].url_format, "stats": stats}
```

### 2.7 Tile Generation

When producing heatmap overlays, always use `getMapId()` and return the tile URL template.
Let GEE handle all rendering. Never attempt to build a raster image locally or construct
tile URLs manually.

---

## 3. Backend Memory Management

### 3.1 The Primary Threat Model

The backend is not at risk from processing large data — the relay rule prevents that.
The actual memory risks are:

- **Thread pool exhaustion** from concurrent GEE calls blocking threads.
- **In-memory cache growth** without TTL eviction over long container uptime.
- **Unbounded GeoJSON construction** if hotspot results are not ranked and capped
  before the response is assembled.

### 3.2 Threading Model — Non-Negotiable

GEE's Python client (`earthengine-api`) is synchronous. FastAPI uses an async event loop.
Calling synchronous blocking I/O directly inside an `async def` handler blocks the entire
event loop — all other requests queue behind it.

All GEE calls must be offloaded with `asyncio.to_thread()`. This is ADR-008.

```python
# Correct — non-blocking, event loop is free
@router.post("/heatmap")
async def get_heatmap(request: HeatmapRequest, _: None = Depends(verify_api_key)):
    result = await asyncio.to_thread(
        gee_service.get_lst_tile,
        request.bbox,
        request.start_date,
        request.end_date
    )

# Wrong — blocks every other request for the full GEE call duration (3–15 seconds)
@router.post("/heatmap")
async def get_heatmap(request: HeatmapRequest, _: None = Depends(verify_api_key)):
    result = gee_service.get_lst_tile(request.bbox, request.start_date, request.end_date)
```

Under concurrent load (multiple users simultaneously), thread pool exhaustion becomes
a risk. The default Python thread pool is sized to CPU count. For production hardening,
see ADR-008 (Celery task queue migration path).

### 3.3 In-Memory Cache Eviction

The dev cache (`dict[str, tuple[Any, float]]`) stores entries until they are accessed
and found to be expired. Over hours of container uptime, stale entries accumulate
without bound. Enforce the following:

- Check TTL at both write time (store expiry timestamp) and read time (return None and
  evict if the entry is past its expiry).
- Add a max-entry guard: if the cache dict exceeds 500 entries, evict the oldest 20%
  before inserting the new entry. This prevents slow memory creep on containers with
  long uptime.

```python
# backend/utils/cache.py
_MAX_CACHE_ENTRIES = 500

def set(key: str, value: Any, ttl_seconds: int) -> None:
    global _cache
    if len(_cache) >= _MAX_CACHE_ENTRIES:
        _evict_oldest(fraction=0.2)
    _cache[key] = (value, time.time() + ttl_seconds)

def get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    value, expiry = entry
    if time.time() > expiry:
        del _cache[key]
        return None
    return value
```

### 3.4 Streaming Responses — A Narrow, Future-Scoped Rule

`StreamingResponse` is appropriate only for endpoints where the payload is structurally
unbounded. For all current v1 endpoints, payloads are bounded and small:

| Endpoint        | Payload description                     | Realistic size |
|-----------------|-----------------------------------------|---------------|
| `/api/heatmap`  | One tile URL string + 3 scalar floats   | < 1 KB        |
| `/api/timeseries` | Two float arrays, max ~240 points    | < 50 KB       |
| `/api/hotspots` | GeoJSON, max 50 centroid features       | < 30 KB       |
| `/api/landuse`  | Tile URL or GeoJSON summary             | < 20 KB       |

Do NOT implement `StreamingResponse` for any v1 endpoint. The complexity is not
justified by the payload sizes this system generates. If a future endpoint genuinely
risks exceeding 500KB (e.g., a bulk export feature), introduce streaming at that point
and document the decision in DECISIONS.md.

### 3.5 Explicit `del` — A Last Resort, Not a Pattern

If a function must construct an exceptional intermediate structure (e.g., transforming
a raw GEE feature list before ranking), use `del` immediately after use. But `del`
appearing in normal service functions is a code smell. It signals that the function
built something the architecture says should not exist. Investigate the cause rather
than treating `del` as a routine cleanup tool.

### 3.6 No Global State for Request Data

User-submitted bbox coordinates, date ranges, or GEE results must never be stored
in module-level variables. All request-scoped data lives within the function call stack
and is released when the handler returns.

```python
# Wrong
_last_bbox: list[float] = []   # module-level state — shared across all requests

# Correct — all data is local to the function call
async def get_heatmap(request: HeatmapRequest):
    result = await asyncio.to_thread(gee_service.get_lst_tile, request.bbox, ...)
    return HeatmapResponse(success=True, data=result)
```

---

## 4. Frontend Rendering Limits

### 4.1 Hotspot Result Cap — Server-Side, Before the Response

The `/api/hotspots` route must return at most `top_n` features, where `top_n` defaults
to 10 and is capped at 50 by Pydantic validation. Ranking and truncation happen in
`gee_service.py` before the GeoJSON is assembled. The browser must never receive an
unbounded feature set.

This is not a frontend concern. Do not send all hotspots to the frontend and expect
JavaScript to rank them. Rank in the service, return only the top N.

### 4.2 Leaflet Layer Lifecycle — Explicit Cleanup Required

When a user changes the bbox, date range, or toggles a layer, the existing Leaflet
`TileLayer` must be explicitly removed from the map before the new one is added.
Lingering hidden layers consume GPU texture memory and maintain active event listeners.

```tsx
// Correct — useEffect cleanup removes the layer before adding the next one
useEffect(() => {
  if (!tileUrl || !map) return
  const layer = L.tileLayer(tileUrl, { attribution: "© GEE / MODIS" }).addTo(map)
  return () => {
    map.removeLayer(layer)   // runs before the next effect, and on unmount
  }
}, [tileUrl, map])
```

Never add a new layer without removing the previous one first. If you find yourself
managing more than two layers simultaneously, reassess the component structure.

### 4.3 Debounce All User Inputs

Every input that triggers an API call must be debounced by a minimum of 300ms.
This is a hard rule, not a suggestion.

| Input                    | Why debouncing is required                                        |
|--------------------------|------------------------------------------------------------------|
| City name search field   | Nominatim policy: max 1 req/sec. Typing fires characters rapidly.|
| Date picker changes      | Each change triggers a GEE call. Users adjust start + end dates. |
| Map bbox changes         | Panning and zooming fires continuous events.                     |

300ms prevents avalanche API calls during normal user interaction. It also happens to
satisfy Nominatim's 1 req/sec usage policy for the geocoding input.

---

## 5. Caching Strategy

### 5.1 Request Lifecycle Order — Non-Negotiable

Every FastAPI route that calls GEE must follow this exact execution order:

1. **Pydantic validation** — request is structurally valid and within limits.
2. **API key check** — request is authenticated (enforced by router dependency).
3. **Cache lookup** — if HIT, return immediately. GEE is never called.
4. **GEE call** — via `asyncio.to_thread`. Only reached on cache MISS.
5. **Cache write** — store result with the correct TTL before returning.
6. **Return response** — with `cached: false` on a miss, `cached: true` on a hit.

```python
@router.post("/heatmap")
async def get_heatmap(
    request: HeatmapRequest,
    _: None = Depends(verify_api_key)
) -> ApiResponse[HeatmapData]:
    cache_key = _build_cache_key("heatmap", request)

    # Step 3 — cache check
    if cached := cache.get(cache_key):
        return ApiResponse(success=True, data=cached, cached=True)

    # Step 4 — GEE call (only on MISS)
    try:
        result = await asyncio.to_thread(
            gee_service.get_lst_tile,
            request.bbox, request.start_date, request.end_date
        )
    except GEEServiceError as e:
        raise HTTPException(status_code=503, detail=e.safe_message)

    # Step 5 — cache write
    cache.set(cache_key, result, ttl_seconds=CACHE_TTL["heatmap"])

    return ApiResponse(success=True, data=result, cached=False)
```

### 5.2 Cache Key Construction

Cache keys must be deterministic for identical logical requests. The normalization
step is what makes this reliable.

```python
# backend/utils/cache.py

def build_cache_key(endpoint: str, bbox: list[float], start_date: str,
                    end_date: str, extra: str = "") -> str:
    """
    Normalize inputs before hashing to prevent cache misses from floating-point
    noise introduced by map panning (e.g., 72.87770001 vs 72.8777).
    """
    normalized_bbox = [round(coord, 4) for coord in bbox]
    raw = f"{normalized_bbox}{start_date}{end_date}{extra}"
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return f"{endpoint}:{digest}"
```

Rounding to 4 decimal places corresponds to ~11m precision at the equator —
far finer than MODIS's 1km resolution, so no valid geographic distinction is lost.

Normalization always happens in `backend/utils/cache.py`. Never in routes or services.

### 5.3 TTL Policy — Authoritative Values

The values below are the single source of truth. If you see different values
elsewhere in the codebase or in earlier document versions, those are errors.
ADR-011 is the governing decision record.

| Endpoint           | TTL        | Rationale |
|--------------------|------------|-----------|
| `/api/heatmap`     | **3 hours**    | GEE tile URL tokens expire in ~4 hours. 3 hours is the safe ceiling. Do NOT increase this. Serving an expired token causes Leaflet to silently stop rendering tiles — there is no error message, just a blank map. |
| `/api/timeseries`  | **24 hours**   | Returns scalar statistics only. No GEE token is involved. Historical MODIS data is immutable — the same query will always produce the same result. |
| `/api/hotspots`    | **3 hours**    | Derived from the same MODIS composite as the heatmap. Follows the same token expiry reasoning. |
| `/api/landuse`     | **24 hours**   | Dynamic World classification changes on timescales of months, not hours. No GEE token involved. |

The 6-hour value that appears in the OpenAPI spec description and in an earlier version
of ARCHITECTURE.md is superseded by ADR-011. The correct value for tile-URL endpoints
is **3 hours**. The OpenAPI spec description field is cosmetic and does not govern
implementation — this document and DECISIONS.md do.

---

## 6. Future Feature: Custom Polygon ROI (Decision Record — Not Implemented in v1)

### Status: Deferred to Sprint 3. Do not implement in Sprint 1 or Sprint 2.

### The Idea
Allow users to draw a custom polygon (5–6 points) on the map as an alternative to
the auto-generated bbox from city search. GEE would analyse only the pixels within
that polygon.

### Why It Has Genuine Merit
City search produces a rectangular bbox. Cities are not rectangles. Mumbai is a peninsula —
a bbox includes substantial ocean area that dilutes LST statistics and distorts hotspot
rankings. A user-drawn polygon would give GEE a precise `ee.Geometry.Polygon` as `roi`,
making `reduceRegion` outputs genuinely representative of the area the user cares about.
GEE handles `ee.Geometry.Polygon` identically to a bbox internally — there is no
additional GEE complexity from this change.

### Why It Is Not a v1 Feature

**Validation complexity.** Bbox area validation uses simple lat/lon arithmetic. Polygon
area requires the Shoelace formula on spherical coordinates (or a library call). This is
tractable but adds test surface area that Sprint 1 does not need.

**Cache key stability.** The current cache key is built from a normalized 4-float bbox,
which is trivially reproducible. A polygon with N vertices requires a canonical
vertex ordering (e.g., always clockwise from the northernmost point) before hashing,
or two geometrically identical polygons drawn in different vertex orders will miss
the cache. This is solvable but not trivial.

**Frontend dependency.** Drawing polygons requires a Leaflet drawing plugin
(Leaflet.draw or Leaflet.pm). Neither is in the locked stack. Adding one requires
a DECISIONS.md entry and a bundle size evaluation.

**UX on constrained screens.** Drawing a precise 5-6 point polygon on a mobile screen
is genuinely difficult. The feature degrades badly on small viewports.

### The Correct Implementation Path (Sprint 3+)

Implement polygon as an optional refinement layered on top of bbox, not as a
replacement for it. The workflow is:

1. User searches for a city → bbox is auto-generated and heatmap renders (existing flow).
2. User clicks "Refine Area" → Leaflet drawing mode activates.
3. User draws a polygon → polygon replaces bbox as the `roi` for all subsequent queries.
4. Clearing the polygon reverts to the bbox.

The API contract changes minimally:

```
# Current (v1)
POST /api/heatmap
{ "bbox": [minLon, minLat, maxLon, maxLat], "start_date": "...", "end_date": "..." }

# Extended (Sprint 3)
POST /api/heatmap
{
  "bbox": [minLon, minLat, maxLon, maxLat],       # still required for validation + cache key base
  "polygon": [[lon1, lat1], [lon2, lat2], ...],   # optional — overrides bbox as GEE roi if present
  "start_date": "...",
  "end_date": "..."
}
```

If `polygon` is present, GEE uses `ee.Geometry.Polygon(polygon)` as `roi`.
If absent, GEE uses `ee.Geometry.Rectangle(bbox)` as before.
Pydantic validates: polygon has 4–10 coordinate pairs, first and last pair are equal
(closed ring), and polygon area does not exceed `MAX_BBOX_AREA_KM2`.

Do not implement this until Sprint 3. Do not design the bbox contract around it now.
When implementing, create ADR-012 in DECISIONS.md.

---

## 7. Anti-Pattern Reference for AI Code Generation

This section exists to prevent common mistakes when AI tools generate code for this project.
If generated code contains any of the following patterns, reject it and request a rewrite.

| Anti-pattern | Why it is wrong |
|---|---|
| `tile_bytes = requests.get(tile_url).content` | Fetches raw pixel data through the backend. Violates the relay rule. |
| `ee.Image(...).getInfo()` on pixel-valued images | Downloads pixel arrays. Causes memory spikes. Only call `.getInfo()` on aggregated results (dicts of scalars). |
| `ImageCollection.map(fn)` before `.filterDate().filterBounds()` | Operates on the global unfiltered collection. Quota exhaustion and timeout. |
| `reduceRegion(scale=None)` or no scale argument | Forces GEE to infer scale. Causes memory overloads. Always specify scale explicitly. |
| `global user_data = ...` at module level | Shared state across requests. Violates session isolation. |
| `StreamingResponse` on any v1 endpoint | Payloads are bounded and small. Streaming adds complexity with zero benefit here. |
| Returning all GEE hotspot features unranked | Must be ranked and capped to `top_n` (max 50) in the service layer before return. |
| Heatmap or hotspot cache TTL set to 6 hours | Risks serving expired GEE tile URL tokens. Silent Leaflet failure. Correct TTL is 3 hours. |
| Cache key built without bbox normalization | Floating-point noise from map panning will cause unnecessary cache misses. Always round to 4 decimal places. |
| Drawing polygon on frontend without Leaflet.draw/Leaflet.pm | Native Leaflet has no polygon drawing. A plugin is required and must be documented in DECISIONS.md. |
| Polygon input implemented as a replacement for bbox | Polygon is a future refinement layered on top of bbox. Bbox remains the primary input contract. |

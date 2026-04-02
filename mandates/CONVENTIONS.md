# Coding Conventions

> Feed this file to every AI coding session alongside CONTEXT.md.
> Deviations from these conventions require an entry in DECISIONS.md.

---

## Guiding Principle
Clarity over cleverness. Every decision should be immediately justifiable
to a developer reading this codebase for the first time.

---

## Python (Backend)

### Naming
| Pattern | Use For |
|---------|---------|
| `snake_case` | Variables, functions, files, modules |
| `PascalCase` | Classes, Pydantic models |
| `SCREAMING_SNAKE_CASE` | Module-level constants |
| `_leading_underscore` | Private helper functions |

Good: `get_lst_tile`, `HeatmapRequest`, `MAX_BBOX_AREA_KM2`
Bad: `getLSTTile`, `heatmap_request`, `maxArea`

### Functions
- Single purpose — one function does one thing
- Soft limit: ~30 lines before considering a split
- All functions have type hints (required, no exceptions)
- Docstring required for any function with non-obvious logic or GEE-specific behavior

```python
# Good
async def get_heatmap(request: HeatmapRequest) -> HeatmapResponse:
    ...

# Bad
async def heatmap(r):
    ...
```

### Async Pattern
All FastAPI route handlers are `async def`.
GEE SDK calls are synchronous — wrap every GEE call with `asyncio.to_thread()`.
Never call GEE synchronously inside an async route handler (blocks the event loop).

```python
# Correct
@router.post("/heatmap")
async def get_heatmap(request: HeatmapRequest) -> HeatmapResponse:
    tile_url = await asyncio.to_thread(
        gee_service.get_lst_tile,
        request.bbox,
        request.start_date,
        request.end_date
    )

# Wrong — blocks the event loop
@router.post("/heatmap")
async def get_heatmap(request: HeatmapRequest) -> HeatmapResponse:
    tile_url = gee_service.get_lst_tile(...)  # synchronous GEE call, never do this
```

### Error Handling
- Never use bare `except:` or `except Exception:`
- Custom exception classes in `utils/exceptions.py`
- All GEE calls wrapped in `try/except ee.EEException`
- Routes catch service-level exceptions and return standard envelope
- Log errors with structured context (not just the message string)

```python
# Correct error handling in service
def get_lst_tile(bbox: BBox, start: str, end: str) -> str:
    try:
        ...gee operations...
    except ee.EEException as e:
        logger.error("GEE LST tile failed", extra={"bbox": bbox, "error": str(e)})
        raise GEEServiceError(code="GEE_COMPUTATION_FAILED", detail=str(e))

# Correct error handling in route
@router.post("/heatmap")
async def get_heatmap(request: HeatmapRequest):
    try:
        result = await asyncio.to_thread(gee_service.get_lst_tile, ...)
        return HeatmapResponse(success=True, data=result)
    except GEEServiceError as e:
        raise HTTPException(status_code=503, detail=e.detail)
```

### Standard Response Envelope
Every endpoint returns this shape. No exceptions.

```python
class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    error: str | None = None
    cached: bool = False
```

### Import Order (isort-compatible)
```python
# 1. Standard library
import asyncio
import hashlib

# 2. Third-party
import ee
from fastapi import APIRouter

# 3. Local
from backend.services import gee_service
from backend.models.heatmap import HeatmapRequest
```

### GEE-Specific Rules
These are non-negotiable. Violating them causes quota exhaustion or timeouts.

1. Always filter by `.filterBounds(roi)` AND `.filterDate(start, end)` before any operation
2. Always add `.limit(500)` to ImageCollections where relevant to cap runaway queries
3. Never call `.getInfo()` inside a loop
4. Always apply scale factor + offset to LST values before returning
5. Always wrap in try/except ee.EEException
6. Never store ee.Image objects — compute, extract the URL/stats, discard

---

## TypeScript / React (Frontend)

### Naming
| Pattern | Use For |
|---------|---------|
| `camelCase` | Variables, functions, props, hooks |
| `PascalCase` | Components, types, interfaces |
| `SCREAMING_SNAKE_CASE` | Constants |
| Descriptive verbs for functions | `fetchLstHeatmap`, `handleLocationSelect` |

Good: `useHeatmapData`, `HeatmapLayer`, `API_BASE_URL`
Bad: `getData`, `heatmap_layer`, `fn`

### Component Rules
- Functional components only (no class components)
- One component per file, filename matches component name
- Props interface defined immediately above the component
- No business logic in components — extract to hooks or services

```tsx
// Component file structure — always follow this order
import statements

interface Props {
  bbox: BBox
  onLoad?: () => void
}

const HeatmapLayer = ({ bbox, onLoad }: Props) => {
  // 1. Hooks
  const { tileUrl, loading, error } = useHeatmapData(bbox)

  // 2. Derived state / early returns
  if (loading) return <LoadingSpinner />
  if (error) return <ErrorCard message={error} />

  // 3. Handlers
  const handleTileLoad = () => onLoad?.()

  // 4. Render
  return <TileLayer url={tileUrl} eventHandlers={{ load: handleTileLoad }} />
}

export default HeatmapLayer
```

### Hooks
- All custom hooks in `src/hooks/`, prefixed with `use`
- One concern per hook — `useHeatmapData`, `useTimeseries`, `useLocationSearch`
- Hooks manage loading + error + data state together

```tsx
// Hook pattern — always return this shape
const useHeatmapData = (bbox: BBox | null) => {
  const [data, setData] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bbox) return
    setLoading(true)
    heatmapService.fetchHeatmap(bbox)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [bbox])

  return { data, loading, error }
}
```

### Services (API Calls)
- All API calls in `src/services/` — never directly in components or hooks
- One service file per backend resource: `heatmapService.ts`, `timeseriesService.ts`
- Returns typed data or throws a typed error — never returns null silently
- Uses the shared axios instance from `src/services/api.ts`

```ts
// src/services/heatmapService.ts
import { api } from './api'
import type { HeatmapRequest, HeatmapResponse } from '../types/heatmap'

export const fetchHeatmap = async (req: HeatmapRequest): Promise<HeatmapResponse> => {
  const { data } = await api.post<ApiResponse<HeatmapResponse>>('/api/heatmap', req)
  if (!data.success) throw new Error(data.error ?? 'Unknown error')
  return data.data!
}
```

### Types
- All API response shapes have a corresponding TypeScript interface in `src/types/`
- No `any` — use `unknown` and type guard if type is genuinely unclear
- Shared primitive types (`BBox`, `DateRange`) in `src/types/common.ts`

### State Management
- Local component state: `useState`
- Cross-component state: React Context (one context per domain: MapContext, UIContext)
- No Redux for MVP
- Map state (bbox, active layers, date range) in `MapContext`

---

## Security Conventions
These are coding-level rules derived from SECURITY.md.
They govern how security is implemented at the code pattern level.

### Backend Security Patterns

**All protected routes use the API key dependency — no exceptions:**
```python
# Every router file follows this pattern
router = APIRouter(dependencies=[Depends(verify_api_key)])
# /health is the ONLY route that does NOT use this dependency
```

**All external calls (GEE) use a typed exception wrapper:**
```python
def call_external_service(...) -> ReturnType:
    try:
        ...  # external call
    except SpecificExternalException as e:
        logger.error("Service call failed", extra={"error_type": type(e).__name__})
        raise OurTypedException(
            code="DESCRIPTIVE_CODE",
            detail=str(e),                          # full detail → logs only
            safe_message="Friendly message for UI"  # this reaches the client
        )
```

**Secrets are never passed as function arguments — always read from settings:**
```python
# Wrong
def init_gee(key_path: str): ...

# Correct
def init_gee():
    settings = get_settings()
    ee.Initialize(credentials_from_file(settings.gee_key_file))
```

**Log statements never include sensitive fields:**
```python
# Wrong
logger.info(f"Request: bbox={bbox}, api_key={api_key}")

# Correct
logger.info("Heatmap request received", extra={"path": "/api/heatmap"})
```

### Frontend Security Patterns

**The Axios instance is the only place the API key header is set:**
```typescript
// src/services/api.ts is the single source of headers
// No other file ever references import.meta.env.VITE_INTERNAL_API_KEY directly
```

**No sensitive data in localStorage or sessionStorage — ever:**
```typescript
// Wrong
localStorage.setItem('apiKey', import.meta.env.VITE_INTERNAL_API_KEY)

// Correct — module scope in api.ts is sufficient
// Axios instance holds it; no browser storage needed
```

**Error messages shown to users come only from the response envelope:**
```typescript
// Correct — use only what backend explicitly sent as safe_message
catch (error) {
  if (axios.isAxiosError(error)) {
    setError(error.response?.data?.error ?? 'Something went wrong')
  }
}
// Never: setError(error.message) — may contain URLs, tokens, or internal paths
```

---

## Shared Rules

### Git Commit Format
```
feat: add heatmap tile layer to Leaflet map
fix: correct MODIS scale factor conversion
refactor: extract bbox validation to utils
docs: update TASKS.md with sprint 2 plan
test: add unit tests for gee_service LST function
```
- One logical change per commit
- Never commit: `.env`, `secrets/`, `node_modules/`, `__pycache__/`, `*.pyc`

### Comments
- Comment *why*, not *what*
- TODOs must include sprint tag: `// TODO(sprint-2): add Redis cache here`
- No commented-out code committed to main branch

### No Magic Numbers
```python
# Bad
if area > 50000:
    raise ValidationError("...")

# Good
MAX_BBOX_AREA_KM2 = 50_000
if area > MAX_BBOX_AREA_KM2:
    raise ValidationError("...")
```

### Testing (when written)
- Backend: pytest, one test file per service
- Frontend: Vitest, one test file per service/hook
- Test naming: `test_should_return_tile_url_when_valid_bbox_provided`
- Mocking: GEE calls are always mocked in tests — never hit real GEE in CI

# Security Architecture & Implementation Guide

> Security is not a feature added at the end.
> Every instruction in this document applies from Sprint 1, Day 1.
> Feed this file alongside CONTEXT.md and CONVENTIONS.md to every AI coding session.

---

## Why This Matters for This Specific App

This platform handles:
- Google Cloud service account credentials (if leaked, someone can run unlimited GEE jobs billed to your project)
- User-submitted geographic coordinates (input that reaches a cloud compute engine)
- Tile URLs with time-limited authentication tokens (if mishandled, can be replayed)
- A public-facing API with no user authentication (anyone on the internet can call it)

Each of these is a specific attack surface. This document addresses all of them.

---

## Security Layers Overview

```
LAYER 1 — Transport Security       (HTTPS everywhere, no plaintext)
LAYER 2 — Secret Management        (keys never in code, never in logs)
LAYER 3 — API Authentication       (frontend ↔ backend trust)
LAYER 4 — Input Security           (validation, size limits, sanitization)
LAYER 5 — HTTP Security Headers    (browser-level protections)
LAYER 6 — Error Handling Hygiene   (no internals leak to clients)
LAYER 7 — Logging Hygiene          (no sensitive data in logs)
LAYER 8 — Dependency Security      (no known-vulnerable packages)
LAYER 9 — GEE Credential Security  (minimal permissions, key rotation)
LAYER 10 — Deployment Security     (CI/CD, environment separation)
LAYER 11 — Token Expiry Handling   (GEE tile URL lifecycle)
```

---

## LAYER 1 — Transport Security (HTTPS)

### Rule
All data in transit must be encrypted. HTTP (unencrypted) is never acceptable in production.

### What this means in practice

**Backend (Render/Railway):**
Both platforms enforce HTTPS by default on their hosted domains
(`https://your-app.onrender.com`). Never disable this.
If you configure a custom domain, enable TLS/SSL in the platform dashboard immediately.
The platform handles certificate issuance (Let's Encrypt) — you don't manage certs manually.

**Frontend (Vercel):**
Vercel enforces HTTPS on all deployments automatically.
Your `VITE_API_BASE_URL` must point to `https://...`, never `http://...` in production.

**Local development:**
`http://localhost` is acceptable for local dev only.
Never deploy a `.env` with `http://` URLs to production.

**Enforce in backend settings:**
```python
# backend/config/settings.py
class Settings(BaseSettings):
    api_base_url: str

    @validator('api_base_url')
    def must_be_https_in_production(cls, v, values):
        if os.getenv("ENV") == "production" and not v.startswith("https://"):
            raise ValueError("API base URL must use HTTPS in production")
        return v
```

**HTTP → HTTPS redirect:**
Add to FastAPI middleware — if a request arrives on HTTP in production, redirect to HTTPS:
```python
# backend/main.py
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware

if settings.env == "production":
    app.add_middleware(HTTPSRedirectMiddleware)
```

---

## LAYER 2 — Secret Management

### The Threat
A service account key committed to a public GitHub repo will be found by automated scanners
within minutes. Google, GitHub, and malicious bots all scan for this.
Result: your GEE quota is consumed by strangers, or you receive a Google Cloud bill.

### Rules — Non-Negotiable

**Rule 2.1 — The .gitignore must exist before the first commit, not after.**
```gitignore
# .gitignore — create this as the FIRST file in the repo

# Secrets
.env
.env.local
.env.production
secrets/
*.json          # catches GEE key files
*.pem
*.key
*.p12

# Python
__pycache__/
*.pyc
*.pyo
.venv/
venv/

# Node
node_modules/
dist/
build/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/settings.json   # ok to commit launch.json but not settings with tokens
.idea/
```

**Rule 2.2 — Never hardcode secrets. Not even temporarily.**
"I'll remove it before committing" is how leaks happen.
If it's in the code file at all, it will eventually be committed.

**Rule 2.3 — Use .env.example as the only committed reference to what secrets exist.**
```env
# .env.example — commit this, it documents what variables are needed
# Copy to .env and fill in real values. NEVER commit .env.

GEE_PROJECT_ID=your-gee-project-id
GEE_SERVICE_ACCOUNT=your-sa@project.iam.gserviceaccount.com
GEE_KEY_FILE=secrets/gee-key.json
ENV=development
ALLOWED_ORIGINS=http://localhost:5173
RATE_LIMIT=10/minute
INTERNAL_API_KEY=generate-a-random-32-char-string-here
REDIS_URL=                    # leave blank for in-memory dev cache
```

**Rule 2.4 — Load secrets only through pydantic-settings.**
```python
# backend/config/settings.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    gee_project_id: str
    gee_service_account: str
    gee_key_file: str
    env: str = "development"
    allowed_origins: list[str]
    rate_limit: str = "10/minute"
    internal_api_key: str
    redis_url: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False

settings = Settings()
```

**Rule 2.5 — Pre-commit hook to block secret commits.**
Install `detect-secrets` or `git-secrets` as a pre-commit hook.
This automatically scans every commit for patterns that look like API keys, tokens, or credentials.

```bash
# Setup (run once per developer)
pip install detect-secrets
detect-secrets scan > .secrets.baseline
```

Add to `.pre-commit-config.yaml`:
```yaml
repos:
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

---

## LAYER 3 — API Authentication (Frontend ↔ Backend)

### The Problem
Without authentication, your backend API is open to the entire internet.
Anyone who finds your backend URL can call `/api/heatmap` in a loop,
exhausting your GEE quota in minutes.

### Solution: Internal API Key

This is simpler than user authentication but sufficient to prevent automated abuse.
The frontend holds one shared key. The backend validates it on every request.
This key is not a user identity — it's a door key. Treat it as a secret.

**Backend — API key middleware:**
```python
# backend/utils/auth.py
from fastapi import Header, HTTPException
from backend.config.settings import settings

async def verify_api_key(x_api_key: str = Header(...)):
    """
    Dependency injected into all protected routes.
    Frontend must send header: X-API-Key: <internal_api_key>
    """
    if x_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")
```

**Backend — Apply to all routes:**
```python
# backend/routes/heatmap.py
from fastapi import APIRouter, Depends
from backend.utils.auth import verify_api_key

router = APIRouter(dependencies=[Depends(verify_api_key)])
```

This means every request to `/api/heatmap`, `/api/timeseries`, etc. must include the header.
Requests without it are rejected before validation, before cache, before GEE.

**Frontend — Axios instance with header:**
```typescript
// frontend/src/services/api.ts
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    'X-API-Key': import.meta.env.VITE_INTERNAL_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 seconds — GEE calls can take up to 15s
})
```

**Frontend .env:**
```env
VITE_API_BASE_URL=https://your-backend.onrender.com
VITE_INTERNAL_API_KEY=your-32-char-random-key
```

**Important:** Vite env vars prefixed with `VITE_` are embedded into the compiled JavaScript bundle
and are visible to anyone who opens browser devtools. This is acceptable for an internal API key
because: (a) the key only grants access to your specific API, (b) rate limiting caps abuse,
(c) GEE credentials remain server-side and are never exposed.
The key prevents automated bot abuse — it is not a substitute for GEE credential protection.

**How to generate the key:**
```python
import secrets
print(secrets.token_urlsafe(32))
# Example output: kJ8mN2pQ7rT4xV1yB6wE9uI3oL5sA0dF
```

---

## LAYER 4 — Input Security

### Validation Rules (Already in Pydantic — Verify These Are Implemented)

```python
# backend/models/heatmap.py
from pydantic import BaseModel, validator
from datetime import date
from backend.utils.geo import compute_bbox_area_km2

MODIS_LAUNCH_DATE = date(2001, 1, 1)
MAX_BBOX_AREA_KM2 = 50_000
MAX_DATE_RANGE_DAYS = 365

class HeatmapRequest(BaseModel):
    bbox: list[float]
    start_date: date
    end_date: date

    @validator('bbox')
    def validate_bbox(cls, v):
        if len(v) != 4:
            raise ValueError("bbox must contain exactly 4 values")
        min_lon, min_lat, max_lon, max_lat = v
        if not (-180 <= min_lon < max_lon <= 180):
            raise ValueError("Invalid longitude range")
        if not (-90 <= min_lat < max_lat <= 90):
            raise ValueError("Invalid latitude range")
        area = compute_bbox_area_km2(v)
        if area > MAX_BBOX_AREA_KM2:
            raise ValueError(f"Area {area:.0f} km² exceeds maximum {MAX_BBOX_AREA_KM2} km²")
        return [round(x, 4) for x in v]   # normalize before cache key generation

    @validator('start_date')
    def validate_start_date(cls, v):
        if v < MODIS_LAUNCH_DATE:
            raise ValueError(f"start_date cannot be before {MODIS_LAUNCH_DATE} (MODIS launch)")
        return v

    @validator('end_date')
    def validate_end_date(cls, v, values):
        if 'start_date' in values:
            delta = (v - values['start_date']).days
            if delta <= 0:
                raise ValueError("end_date must be after start_date")
            if delta > MAX_DATE_RANGE_DAYS:
                raise ValueError(f"Date range cannot exceed {MAX_DATE_RANGE_DAYS} days")
        return v
```

### Request Size Limit

Add to FastAPI startup — prevents large payload attacks:
```python
# backend/main.py
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["your-backend.onrender.com", "localhost"]
)

# Limit request body to 10KB — our payloads are tiny JSON, never need more
@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 10_240:  # 10KB
        return JSONResponse(status_code=413, content={"error": "Request too large"})
    return await call_next(request)
```

### Query Parameter Sanitization

For GET endpoints that receive bbox as a query string:
```python
# backend/utils/validators.py
def parse_bbox_from_query(bbox_str: str) -> list[float]:
    """
    Parse and validate bbox from query string format: "minLon,minLat,maxLon,maxLat"
    Raises ValueError with specific message on any invalid input.
    """
    try:
        parts = bbox_str.strip().split(',')
        if len(parts) != 4:
            raise ValueError("bbox must be 4 comma-separated numbers")
        return [float(p.strip()) for p in parts]
    except (TypeError, ValueError):
        raise ValueError("bbox must be 4 comma-separated floats e.g. 72.77,18.89,72.99,19.27")
```

---

## LAYER 5 — HTTP Security Headers

These headers tell the browser how to behave when rendering your frontend.
They prevent a class of attacks (XSS, clickjacking, MIME sniffing) at zero cost.

### Backend — Add SecurityHeadersMiddleware

```python
# backend/utils/security_headers.py
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response
```

```python
# backend/main.py — register the middleware
from backend.utils.security_headers import SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware)
```

### What Each Header Does (Plain English)

| Header | What it prevents |
|--------|-----------------|
| `X-Content-Type-Options: nosniff` | Browser won't try to guess the file type of a response — prevents MIME-type confusion attacks |
| `X-Frame-Options: DENY` | Your app can't be embedded in an `<iframe>` on another site — prevents clickjacking |
| `X-XSS-Protection` | Older browsers' built-in XSS filter — belt-and-suspenders |
| `Referrer-Policy` | Controls what URL info is sent when your app makes external requests |
| `Strict-Transport-Security` | Tells browsers to always use HTTPS for this domain, even if they try HTTP |
| `Permissions-Policy` | Blocks the page from accessing camera/mic/location unless explicitly needed |

### Frontend — Content Security Policy (Vercel)

Add to `vercel.json` in your frontend root:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org https://earthengine.googleapis.com; connect-src 'self' https://your-backend.onrender.com https://nominatim.openstreetmap.org; frame-ancestors 'none'"
        }
      ]
    }
  ]
}
```

This tells the browser: only load scripts, images, and API connections from sources explicitly listed here.
If a malicious script tries to phone home to an unknown server, the browser blocks it.

---

## LAYER 6 — Error Handling Hygiene

### Rule: Internal errors never reach the client verbatim.

A stack trace returned to the browser contains your file structure, library versions,
and sometimes variable values — all useful to an attacker mapping your system.

**What the client should see:**
```json
{
  "success": false,
  "data": null,
  "error": "GEE computation failed. Try a smaller area or different date range.",
  "cached": false
}
```

**What the client must never see:**
```
Traceback (most recent call last):
  File "/app/backend/services/gee_service.py", line 47, in get_lst_tile
    result = image.getMapId(viz_params)
ee.ee_exception.EEException: User memory limit exceeded after 4096MB...
```

**Implementation — Global exception handler:**
```python
# backend/main.py
import logging
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log the full error internally (for your debugging)
    logger.error(
        "Unhandled exception",
        extra={
            "path": request.url.path,
            "method": request.method,
            "error_type": type(exc).__name__,
            # Do NOT log request body here — may contain coordinates
        },
        exc_info=True   # captures full traceback in logs, not in response
    )
    # Return a safe, generic message to the client
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": "An internal error occurred. Please try again.",
            "cached": False,
        }
    )
```

**Custom exception hierarchy:**
```python
# backend/utils/exceptions.py
class UHIBaseException(Exception):
    """Base for all application exceptions."""
    def __init__(self, code: str, detail: str, safe_message: str):
        self.code = code
        self.detail = detail          # full detail — logged internally only
        self.safe_message = safe_message  # what the client sees
        super().__init__(detail)

class GEEServiceError(UHIBaseException):
    pass

class ValidationError(UHIBaseException):
    pass
```

---

## LAYER 7 — Logging Hygiene

### The Problem
Logs are often stored in third-party services (Render logs, Papertrail, etc.).
Sensitive data in logs = sensitive data in systems you don't fully control.

### Rules

**Never log:**
- The full bbox coordinates alongside any user identifier or IP
- API keys or auth headers (even partially — no "key=abc123...")
- Full request bodies
- GEE service account details
- Redis connection strings

**Always log:**
- Request path + method (for debugging)
- Cache hit/miss (for performance monitoring)
- Error type and code (not the full message if it contains user data)
- Response status code
- Request duration (for performance monitoring)

**Structured logging setup:**
```python
# backend/config/logging_config.py
import logging
import json

class SafeJSONFormatter(logging.Formatter):
    SENSITIVE_KEYS = {'api_key', 'x_api_key', 'authorization', 'password', 'token', 'key_file'}

    def format(self, record):
        log_obj = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        # Include extra fields but strip any sensitive keys
        if hasattr(record, '__dict__'):
            for k, v in record.__dict__.items():
                if k not in ('msg', 'args', 'levelname', 'name', 'pathname',
                             'filename', 'module', 'exc_info', 'stack_info',
                             'lineno', 'funcName', 'created', 'msecs',
                             'relativeCreated', 'thread', 'threadName',
                             'processName', 'process', 'message', 'asctime'):
                    if k.lower() not in self.SENSITIVE_KEYS:
                        log_obj[k] = v
        return json.dumps(log_obj)
```

**Request logging middleware:**
```python
# backend/utils/request_logger.py
import time
from starlette.middleware.base import BaseHTTPMiddleware

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000)
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,   # path only — no query params (may contain bbox)
                "status": response.status_code,
                "duration_ms": duration_ms,
            }
        )
        return response
```

---

## LAYER 8 — Dependency Security

### The Threat
Libraries you install can have known vulnerabilities. A library with an unpatched CVE
is an open door regardless of how well your own code is written.

### Backend — pip audit

```bash
# Install
pip install pip-audit

# Run (add to CI pipeline — see Layer 10)
pip-audit

# Output: tells you which packages have known CVEs and what version fixes them
```

### Frontend — npm audit

```bash
# Built into npm
npm audit

# Auto-fix low/moderate issues
npm audit fix

# See full report
npm audit --json
```

### Version pinning

Pin all dependency versions in `requirements.txt` and `package.json`.
Never use `>=` or `*` version specifiers in production dependency files.

```
# requirements.txt — pin exact versions
fastapi==0.111.0
earthengine-api==0.1.396
pydantic==2.7.1
slowapi==0.1.9
```

### Automated dependency updates

Add Dependabot to your GitHub repo (free):
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "pip"
    directory: "/backend"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
```

Dependabot opens PRs automatically when a dependency has an update or security fix.

---

## LAYER 9 — GEE Credential Security

### Principle of Least Privilege
The service account used by this app should have exactly the permissions it needs — nothing more.
If the key is ever compromised, the blast radius is limited to GEE operations only.

### Required IAM roles (Google Cloud Console)
```
roles/earthengine.writer     ← minimum required to call GEE APIs
```

Do NOT grant:
```
roles/owner                  ← full project control
roles/editor                 ← can modify all resources
roles/storage.admin          ← not needed
roles/billing.admin          ← catastrophic if compromised
```

### Service Account Setup Checklist
- [ ] Create a dedicated service account for this app (not your personal account)
- [ ] Name it descriptively: `uhi-platform-gee-sa@your-project.iam.gserviceaccount.com`
- [ ] Grant only `roles/earthengine.writer`
- [ ] Download the JSON key once — store in `secrets/gee-key.json` — gitignored
- [ ] Never share this key over email, Slack, or any messaging platform
- [ ] Set a reminder to rotate the key every 90 days (delete old, generate new)

### Key rotation procedure (every 90 days)
```
1. Google Cloud Console → IAM → Service Accounts → your SA → Keys
2. Add Key → Create new JSON key → download
3. Replace secrets/gee-key.json locally
4. Update the key in Render/Railway environment variables
5. Verify the app still works
6. Delete the old key in Google Cloud Console
```

### GEE quota monitoring
```
Google Cloud Console → APIs & Services → Google Earth Engine API → Quotas
```
Set up a billing alert at $0 (you should never be billed on free tier).
If you suddenly see usage, your key may be compromised — rotate immediately.

---

## LAYER 10 — Deployment & CI/CD Security

### Environment Separation

Never share secrets between environments:

```
Development    →  .env file (local, gitignored)
Production     →  Platform environment variables (Render dashboard / Vercel dashboard)
```

Specifically, the production `INTERNAL_API_KEY` must be different from the dev one.
If dev key leaks (e.g. in a test file), production is unaffected.

### GitHub Actions — Never put secrets in workflow files

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  lint-and-type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Python type check
        run: |
          pip install mypy
          mypy backend/

      - name: Security audit
        run: |
          pip install pip-audit
          pip-audit

      - name: Frontend audit
        working-directory: frontend
        run: npm audit --audit-level=high
```

Secrets needed for CI go in: `GitHub repo → Settings → Secrets and variables → Actions`
They are referenced as `${{ secrets.YOUR_SECRET_NAME }}` — never hardcoded in YAML.

### Branch protection

In GitHub repo settings → Branches → Add rule for `main`:
- [ ] Require pull request before merging
- [ ] Require status checks to pass (CI must be green)
- [ ] Prevent force pushes
- [ ] Prevent deletion

This ensures no untested or unreviewed code reaches the main branch.

---

## LAYER 11 — GEE Tile URL Token Expiry

### The Problem
GEE tile URLs generated by `getMapId()` contain an authentication token.
This token expires after approximately 4 hours.
If a tile URL is cached for longer than its token's lifespan, Leaflet will
silently stop rendering tiles after the token expires — a confusing UI failure
with no clear error message.

### Solution: Cache TTL must be shorter than token lifespan

```python
# backend/utils/cache.py
CACHE_TTL = {
    "heatmap": 3 * 60 * 60,       # 3 hours — safely under GEE's ~4hr token TTL
    "timeseries": 24 * 60 * 60,   # 24 hours — no token involved, stats only
    "hotspots": 3 * 60 * 60,      # 3 hours — derived from tile, same reasoning
    "landuse": 24 * 60 * 60,      # 24 hours — no token involved, stats only
}
```

### Solution: Token refresh endpoint (Sprint 2+)

For long-running user sessions, add a lightweight refresh:
```
GET /api/heatmap/refresh?cache_key=...
→ Re-runs only the getMapId() call (fast — image is already computed by GEE)
→ Returns new tile_url with fresh token
→ Frontend replaces the Leaflet TileLayer
```

The frontend can trigger this automatically if the user has been on the page for 3+ hours
(rare, but possible for researchers doing extended analysis).

---

## Security Checklist by Sprint

### Sprint 1 (Before any code is deployed)
- [ ] `.gitignore` created as first file — verify secrets/ and .env are ignored
- [ ] `detect-secrets` pre-commit hook installed
- [ ] `.env.example` committed with all keys, no real values
- [ ] GEE service account created with `roles/earthengine.writer` only
- [ ] Internal API key generated and stored in `.env` (never committed)
- [ ] CORS configured with explicit origin list (not `*`)
- [ ] Global exception handler returns generic messages (no stack traces)
- [ ] Request size limit middleware added

### Sprint 2 (Before frontend calls backend)
- [ ] API key auth middleware on all routes
- [ ] Frontend Axios instance sends `X-API-Key` header
- [ ] Security headers middleware added to backend
- [ ] `vercel.json` with Content Security Policy configured

### Sprint 3 (Before any external deployment)
- [ ] `pip-audit` clean — no known CVEs
- [ ] `npm audit` clean at high/critical level
- [ ] All dependency versions pinned
- [ ] Logging middleware in place — verify no sensitive data in logs
- [ ] HTTPS enforced in production settings

### Sprint 4 (Before public URL is shared)
- [ ] GitHub branch protection enabled on `main`
- [ ] CI pipeline running on every PR
- [ ] Production and dev API keys are different
- [ ] GEE quota alert set at $0 in Google Cloud Console
- [ ] Tile URL cache TTL confirmed at 3 hours (below token expiry)
- [ ] Dependabot enabled

---

## Quick Reference: What Goes Where

| Secret / Sensitive Item | Location | Never In |
|------------------------|----------|----------|
| GEE service account key | `secrets/gee-key.json` (gitignored) | Code, logs, frontend |
| GEE project ID | `.env` → settings | Code, frontend bundle |
| Internal API key | `.env` (backend) + `.env` (frontend as VITE_) | Git, logs |
| Redis URL | `.env` | Code |
| `ALLOWED_ORIGINS` | `.env` | Code |
| Stack traces | Server logs only | HTTP responses |
| User bbox coordinates | Request logs stripped | Long-term storage |
| Production secrets | Platform env vars dashboard | `.env` committed to git |

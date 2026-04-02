import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

try:
    import ee
except ImportError:  # pragma: no cover
    ee = None

from backend.config.settings import get_settings
from backend.routes.heatmap import router as heatmap_router
from backend.routes.health import router as health_router
from backend.utils.security_headers import SecurityHeadersMiddleware


logger = logging.getLogger(__name__)


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI, max_body_size: int) -> None:
        super().__init__(app)
        self.max_body_size = max_body_size

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_body_size:
                    return JSONResponse(
                        status_code=413, content={"detail": "Request body too large"}
                    )
            except ValueError:
                return JSONResponse(
                    status_code=413, content={"detail": "Invalid Content-Length"}
                )
        else:
            body = await request.body()
            if len(body) > self.max_body_size:
                return JSONResponse(
                    status_code=413, content={"detail": "Request body too large"}
                )

        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    app.state.gee_available = False

    if settings.demo_mode:
        logger.info("Demo mode enabled; skipping GEE initialization")
        yield
        return

    if ee is None:
        raise RuntimeError("earthengine-api is required when DEMO_MODE=false")

    try:
        credentials = ee.ServiceAccountCredentials(
            settings.gee_service_account,
            settings.gee_key_file,
        )
        ee.Initialize(credentials, project=settings.gee_project_id)
        app.state.gee_available = True
        logger.info("GEE initialized successfully")
    except Exception as exc:  # pragma: no cover
        logger.error(
            "GEE initialization failed; continuing without live GEE",
            exc_info=exc,
        )

    yield


app = FastAPI(lifespan=lifespan)
settings = get_settings()

# 1) Security headers
app.add_middleware(SecurityHeadersMiddleware)

# 2) CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# 3) Request size limit (10KB)
app.add_middleware(RequestSizeLimitMiddleware, max_body_size=10 * 1024)

app.include_router(health_router)
app.include_router(heatmap_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": "Internal error",
            "cached": False,
        },
    )

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from backend.config.settings import get_settings
from backend.models.heatmap import (
    ApiResponse,
    HeatmapData,
    HeatmapRequest,
    ProbeData,
    ProbeRequest,
)
from backend.services import gee_service
from backend.utils import cache
from backend.utils.auth import verify_api_key
from backend.utils.cache import CACHE_TTL_HEATMAP, make_cache_key
from backend.utils.exceptions import GEEServiceError, ValidationError


router = APIRouter(prefix="/api", dependencies=[Depends(verify_api_key)])
settings = get_settings()


def _shrink_bbox(bbox: list[float], shrink_factor: float) -> list[float]:
    min_lon, min_lat, max_lon, max_lat = bbox
    center_lon = (min_lon + max_lon) / 2
    center_lat = (min_lat + max_lat) / 2
    half_width = (max_lon - min_lon) * shrink_factor / 2
    half_height = (max_lat - min_lat) * shrink_factor / 2
    return [
        center_lon - half_width,
        center_lat - half_height,
        center_lon + half_width,
        center_lat + half_height,
    ]


@router.post("/heatmap", response_model=ApiResponse[HeatmapData])
async def get_heatmap(request: HeatmapRequest) -> ApiResponse[HeatmapData]:
    key = make_cache_key(
        "heatmap",
        str(request.bbox),
        request.start_date.isoformat(),
        request.end_date.isoformat(),
        request.mode,
    )

    cached_result = cache.get(key)
    if cached_result is not None:
        return ApiResponse(success=True, data=cached_result, cached=True)

    candidate_bboxes = [request.bbox]
    candidate_bboxes.append(_shrink_bbox(request.bbox, 0.7))
    candidate_bboxes.append(_shrink_bbox(request.bbox, 0.45))

    first_error: str | None = None
    for candidate_bbox in candidate_bboxes:
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    gee_service.get_lst_tile,
                    candidate_bbox,
                    request.start_date.isoformat(),
                    request.end_date.isoformat(),
                    request.mode,
                ),
                timeout=settings.gee_request_timeout_seconds,
            )
            cache.set(key, result, CACHE_TTL_HEATMAP)
            return ApiResponse(success=True, data=result, cached=False)
        except asyncio.TimeoutError:
            if first_error is None:
                first_error = "Satellite processing timed out. Try a smaller area or shorter range."
        except GEEServiceError as e:
            if first_error is None:
                first_error = e.safe_message

    fallback_payload = gee_service.get_fallback_tile(
        request.start_date.isoformat(),
        request.mode,
    )
    cache.set(key, fallback_payload, CACHE_TTL_HEATMAP)
    return ApiResponse(
        success=True,
        data=fallback_payload,
        error=first_error
        or "Live satellite compute unavailable; showing fallback tile.",
        cached=False,
    )


@router.post("/probe", response_model=ApiResponse[ProbeData])
async def get_probe(request: ProbeRequest) -> ApiResponse[ProbeData]:
    key = make_cache_key(
        "probe",
        str(request.lat),
        str(request.lon),
        request.start_date.isoformat(),
        request.end_date.isoformat(),
    )

    cached_result = cache.get(key)
    if cached_result is not None:
        return ApiResponse(success=True, data=cached_result, cached=True)

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                gee_service.get_point_probe,
                request.lat,
                request.lon,
                request.start_date.isoformat(),
                request.end_date.isoformat(),
            ),
            timeout=settings.gee_request_timeout_seconds,
        )
        cache.set(key, result, CACHE_TTL_HEATMAP)
        return ApiResponse(success=True, data=result, cached=False)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail="Satellite probe timed out. Try again with a smaller area window.",
        )
    except GEEServiceError as e:
        raise HTTPException(status_code=503, detail=e.safe_message)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.safe_message)

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from backend.config.settings import get_settings
from backend.models.heatmap import ApiResponse
from backend.models.timeseries import TimeseriesData, TimeseriesRequest
from backend.services import gee_service
from backend.utils import cache
from backend.utils.auth import verify_api_key
from backend.utils.cache import CACHE_TTL_HEATMAP, make_cache_key
from backend.utils.exceptions import GEEServiceError


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


@router.post("/timeseries", response_model=ApiResponse[TimeseriesData])
async def get_timeseries(request: TimeseriesRequest) -> ApiResponse[TimeseriesData]:
    key = make_cache_key(
        "timeseries",
        str(request.bbox),
        str(request.start_date),
        str(request.end_date),
    )

    cached_result = cache.get(key)
    if cached_result is not None:
        return ApiResponse(success=True, data=cached_result, cached=True)

    candidate_bboxes = [
        request.bbox,
        _shrink_bbox(request.bbox, 0.65),
        _shrink_bbox(request.bbox, 0.45),
    ]
    first_error: str | None = None
    result = None

    for candidate_bbox in candidate_bboxes:
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    gee_service.get_lst_timeseries,
                    candidate_bbox,
                    request.start_date.isoformat(),
                    request.end_date.isoformat(),
                ),
                timeout=settings.gee_request_timeout_seconds,
            )
            break
        except asyncio.TimeoutError:
            if first_error is None:
                first_error = "Satellite timeseries timed out. Try a smaller area or shorter date range."
        except GEEServiceError as e:
            if first_error is None:
                first_error = e.safe_message

    if result is None:
        raise HTTPException(
            status_code=503, detail=first_error or "Satellite timeseries unavailable."
        )

    series = result.get("series", [])
    payload = {
        "series": series,
        "image_count": len(series),
    }

    cache.set(key, payload, CACHE_TTL_HEATMAP)

    if len(series) == 0:
        return ApiResponse(
            success=True,
            data=payload,
            error="No cloud-free scenes in this window",
            cached=False,
        )

    return ApiResponse(success=True, data=payload, cached=False)

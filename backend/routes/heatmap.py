import asyncio

from fastapi import APIRouter, Depends, HTTPException

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

    try:
        result = await asyncio.to_thread(
            gee_service.get_lst_tile,
            request.bbox,
            request.start_date.isoformat(),
            request.end_date.isoformat(),
            request.mode,
        )
        cache.set(key, result, CACHE_TTL_HEATMAP)
        return ApiResponse(success=True, data=result, cached=False)
    except GEEServiceError as e:
        raise HTTPException(status_code=503, detail=e.safe_message)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.safe_message)


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
        result = await asyncio.to_thread(
            gee_service.get_point_probe,
            request.lat,
            request.lon,
            request.start_date.isoformat(),
            request.end_date.isoformat(),
        )
        cache.set(key, result, CACHE_TTL_HEATMAP)
        return ApiResponse(success=True, data=result, cached=False)
    except GEEServiceError as e:
        raise HTTPException(status_code=503, detail=e.safe_message)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.safe_message)

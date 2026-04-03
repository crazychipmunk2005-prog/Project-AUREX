import calendar
import logging
from datetime import date, timedelta

import ee

from backend.utils.exceptions import GEEServiceError


logger = logging.getLogger(__name__)

BASELINE_START_YEAR = 2019
BASELINE_END_YEAR = 2023


def _safe_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _build_absolute_image(roi: ee.Geometry, start_date: str, end_date: str) -> ee.Image:
    return (
        ee.ImageCollection("MODIS/061/MOD11A2")
        .filterDate(start_date, end_date)
        .filterBounds(roi)
        .select("LST_Day_1km")
        .mean()
        .multiply(0.02)
        .subtract(273.15)
        .rename("LST")
    )


def _build_anomaly_image(roi: ee.Geometry, start_date: str, end_date: str) -> ee.Image:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    window_days = max(1, (end - start).days)

    target = _build_absolute_image(roi, start_date, end_date)

    baseline_images = []
    for year in range(BASELINE_START_YEAR, BASELINE_END_YEAR + 1):
        baseline_start = _safe_date(year, start.month, start.day)
        baseline_end = baseline_start + timedelta(days=window_days)
        baseline_images.append(
            _build_absolute_image(
                roi, baseline_start.isoformat(), baseline_end.isoformat()
            )
        )

    baseline = ee.ImageCollection(baseline_images).mean().rename("LST")
    return target.subtract(baseline).rename("LST")


def _compute_local_viz_bounds(
    image: ee.Image, roi: ee.Geometry, mode: str
) -> dict[str, float]:
    percentiles = (
        image.reduceRegion(
            reducer=ee.Reducer.percentile([2, 98]),
            geometry=roi,
            scale=1000,
            maxPixels=1e9,
        ).getInfo()
        or {}
    )

    p2 = float(percentiles.get("LST_p2", 0))
    p98 = float(percentiles.get("LST_p98", 0))

    if mode == "anomaly":
        span = max(abs(p2), abs(p98), 1.5)
        return {"min": -span, "max": span}

    if p2 >= p98:
        return {"min": 20.0, "max": 50.0}

    return {"min": p2, "max": p98}


def _wind_speed_image(start_date: str, end_date: str) -> ee.Image:
    u = (
        ee.ImageCollection("ECMWF/ERA5_LAND/HOURLY")
        .filterDate(start_date, end_date)
        .select("u_component_of_wind_10m")
        .mean()
    )
    v = (
        ee.ImageCollection("ECMWF/ERA5_LAND/HOURLY")
        .filterDate(start_date, end_date)
        .select("v_component_of_wind_10m")
        .mean()
    )
    return u.pow(2).add(v.pow(2)).sqrt().rename("wind_speed")


def get_lst_tile(
    bbox: list[float], start_date: str, end_date: str, mode: str = "absolute"
) -> dict:
    logger.info("GEE LST tile request")
    logger.debug(
        "LST request params",
        extra={
            "bbox": bbox,
            "start_date": start_date,
            "end_date": end_date,
            "mode": mode,
        },
    )

    try:
        roi = ee.Geometry.Rectangle(bbox)

        image = (
            _build_anomaly_image(roi, start_date, end_date)
            if mode == "anomaly"
            else _build_absolute_image(roi, start_date, end_date)
        )

        viz_bounds = _compute_local_viz_bounds(image, roi, mode)
        palette = (
            ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]
            if mode == "absolute"
            else ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]
        )
        viz_params = {
            "min": viz_bounds["min"],
            "max": viz_bounds["max"],
            "palette": palette,
        }

        tile_info = image.getMapId(viz_params)
        tile_url = tile_info["tile_fetcher"].url_format

        stats = image.reduceRegion(
            reducer=ee.Reducer.minMax().combine(ee.Reducer.mean(), sharedInputs=True),
            geometry=roi,
            scale=1000,
            maxPixels=1e9,
        ).getInfo()

        stats = stats or {}
        result = {
            "tile_url": tile_url,
            "stats": {
                "min_temp": round(stats.get("LST_min", 0), 2),
                "max_temp": round(stats.get("LST_max", 0), 2),
                "mean_temp": round(stats.get("LST_mean", 0), 2),
            },
        }

        logger.info("GEE LST tile success")
        return result
    except ee.EEException as e:
        logger.error("GEE LST tile failed", extra={"error_type": type(e).__name__})
        raise GEEServiceError(
            code="GEE_LST_TILE_FAILED",
            detail=str(e),
            safe_message="Satellite data fetch failed. Try a smaller area or different dates.",
        )


def get_point_probe(lat: float, lon: float, start_date: str, end_date: str) -> dict:
    logger.info("GEE probe request")
    logger.debug(
        "Probe request params",
        extra={"lat": lat, "lon": lon, "start_date": start_date, "end_date": end_date},
    )

    try:
        point = ee.Geometry.Point([lon, lat])
        roi = point.buffer(500)

        absolute_image = _build_absolute_image(roi, start_date, end_date)
        anomaly_image = _build_anomaly_image(roi, start_date, end_date)
        wind_image = _wind_speed_image(start_date, end_date)

        absolute_stats = (
            absolute_image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=point,
                scale=1000,
                maxPixels=1e8,
            ).getInfo()
            or {}
        )

        anomaly_stats = (
            anomaly_image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=point,
                scale=1000,
                maxPixels=1e8,
            ).getInfo()
            or {}
        )

        wind_stats = (
            wind_image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=point,
                scale=10000,
                maxPixels=1e8,
            ).getInfo()
            or {}
        )

        return {
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "avg_temp": round(float(absolute_stats.get("LST", 0)), 2),
            "anomaly_temp": round(float(anomaly_stats.get("LST", 0)), 2),
            "wind_speed": round(float(wind_stats.get("wind_speed", 0)), 2),
        }
    except ee.EEException as e:
        logger.error("GEE probe failed", extra={"error_type": type(e).__name__})
        raise GEEServiceError(
            code="GEE_PROBE_FAILED",
            detail=str(e),
            safe_message="Satellite data probe failed at this location.",
        )

import calendar
import logging
from datetime import date, timedelta
from urllib.parse import quote

import ee

from backend.utils.exceptions import GEEServiceError


logger = logging.getLogger(__name__)

BASELINE_START_YEAR = 2019
BASELINE_END_YEAR = 2023
FALLBACK_START_YEAR = 2019
FALLBACK_END_YEAR = 2025
FALLBACK_SEASONAL_MONTHS = (1, 4, 8)
FALLBACK_TITILER_BASE = "https://aurex-tiles.onrender.com"
FALLBACK_LST_COG_FOLDER_URL = (
    "https://media.githubusercontent.com/media/crazychipmunk2005-prog/"
    "Project-AUREX/main/x-data/v1/region/lst/seasonal_landsat_2019_2025"
)


def _in_demo_mode() -> bool:
    from backend.config.settings import get_settings

    return get_settings().demo_mode


def _safe_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _nearest_seasonal_month(month: int) -> int:
    return min(FALLBACK_SEASONAL_MONTHS, key=lambda candidate: abs(candidate - month))


def _fallback_landsat_tile_url(start_date: str) -> str:
    start = date.fromisoformat(start_date)
    year = min(max(start.year, FALLBACK_START_YEAR), FALLBACK_END_YEAR)
    month = _nearest_seasonal_month(start.month)
    source_url = (
        f"{FALLBACK_LST_COG_FOLDER_URL}/AUREX_LST_Kerala_{year}_{month:02d}.tif"
    )
    encoded_source = quote(source_url, safe="")
    return (
        f"{FALLBACK_TITILER_BASE}/cog/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}"
        f"?url={encoded_source}&bidx=1&rescale=20,45&colormap_name=inferno"
    )


def _fallback_landsat_response(start_date: str) -> dict:
    return {
        "tile_url": _fallback_landsat_tile_url(start_date),
        "stats": {
            "min_temp": 22.5,
            "max_temp": 38.2,
            "mean_temp": 29.8,
        },
    }


def _build_absolute_image(roi: ee.Geometry, start_date: str, end_date: str) -> ee.Image:
    def _collection_window(s: str, e: str, cloud_cover: float) -> ee.ImageCollection:
        return (
            ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
            .filterDate(s, e)
            .filterBounds(roi)
            .select("ST_B10")
            .filter(ee.Filter.lt("CLOUD_COVER", cloud_cover))
        )

    primary = _collection_window(start_date, end_date, 30)
    if primary.size().getInfo() == 0:
        anchor = date.fromisoformat(start_date)
        expanded_start = max(date(2013, 4, 1), anchor - timedelta(days=24))
        expanded_end = anchor + timedelta(days=24)

        fallback = _collection_window(
            expanded_start.isoformat(), expanded_end.isoformat(), 70
        )
        if fallback.size().getInfo() > 0:
            primary = fallback
        else:
            primary = (
                ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
                .filterDate(expanded_start.isoformat(), expanded_end.isoformat())
                .filterBounds(roi)
                .select("ST_B10")
            )

    # Preserve native structure; avoid aggressive smoothing artifacts.
    return primary.mean().multiply(0.00341802).add(149.0).subtract(273.15).rename("LST")


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


def _fallback_anomaly_response(start_date: str) -> dict:
    return {
        "tile_url": _fallback_landsat_tile_url(start_date),
        "stats": {
            "min_temp": -2.4,
            "max_temp": 2.8,
            "mean_temp": 0.3,
        },
    }


def get_fallback_tile(start_date: str, mode: str = "absolute") -> dict:
    if mode == "anomaly":
        return _fallback_anomaly_response(start_date)
    return _fallback_landsat_response(start_date)


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

    if _in_demo_mode():
        logger.info("Demo mode - returning Landsat fallback tile")
        return get_fallback_tile(start_date, mode)

    try:
        roi = ee.Geometry.Rectangle(bbox)
        area = roi.area(maxError=1).getInfo()

        scale = 1000  # Default scale
        if area > 1_000_000_000:  # 1,000 km^2
            scale = 2000
        if area > 5_000_000_000:  # 5,000 km^2
            scale = 5000

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
            scale=scale,
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
    except Exception as e:
        logger.warning(
            "GEE LST tile failed; serving Landsat fallback tile",
            extra={"error_type": type(e).__name__},
        )
        return get_fallback_tile(start_date, mode)


def get_point_probe(lat: float, lon: float, start_date: str, end_date: str) -> dict:
    logger.info("GEE probe request")
    logger.debug(
        "Probe request params",
        extra={"lat": lat, "lon": lon, "start_date": start_date, "end_date": end_date},
    )

    if _in_demo_mode():
        logger.info("Demo mode - returning demo probe data")
        return {
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "avg_temp": 28.5,
            "anomaly_temp": 1.2,
            "wind_speed": 3.8,
        }

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


def get_lst_timeseries(bbox: list[float], start_date: str, end_date: str) -> dict:
    logger.info("GEE LST timeseries request")
    logger.debug(
        "Timeseries request params",
        extra={"bbox": bbox, "start_date": start_date, "end_date": end_date},
    )

    try:
        roi = ee.Geometry.Rectangle(bbox)
        l8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
        col = (
            l8.merge(l9)
            .filterDate(start_date, end_date)
            .filterBounds(roi)
            .filter(ee.Filter.lt("CLOUD_COVER", 20))
            .select("ST_B10")
        )

        def process(img: ee.Image) -> ee.Feature:
            lst_c = img.multiply(0.00341802).add(149.0).subtract(273.15)
            val = lst_c.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=roi,
                scale=30,
                maxPixels=1e9,
            ).get("ST_B10")
            return ee.Feature(
                None,
                {"date": img.date().format("YYYY-MM-dd"), "temp": val},
            )

        features = ee.FeatureCollection(col.map(process))
        dates = features.aggregate_array("date").getInfo() or []
        temps = features.aggregate_array("temp").getInfo() or []

        series: list[dict[str, float | str]] = []
        for date_str, temp_value in zip(dates, temps):
            if temp_value is None:
                continue
            series.append({"date": str(date_str), "temp": round(float(temp_value), 2)})

        series.sort(key=lambda point: str(point["date"]))
        return {"series": series}
    except ee.EEException as e:
        logger.error("GEE timeseries failed", extra={"error_type": type(e).__name__})
        raise GEEServiceError(
            code="GEE_TIMESERIES_FAILED",
            detail=str(e),
            safe_message="Satellite timeseries unavailable for this area/date range.",
        )

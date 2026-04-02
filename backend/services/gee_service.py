import logging

import ee

from backend.utils.exceptions import GEEServiceError


logger = logging.getLogger(__name__)


def get_lst_tile(bbox: list[float], start_date: str, end_date: str) -> dict:
    logger.info("GEE LST tile request")
    logger.debug(
        "LST request params",
        extra={"bbox": bbox, "start_date": start_date, "end_date": end_date},
    )

    try:
        roi = ee.Geometry.Rectangle(bbox)

        image = (
            ee.ImageCollection("MODIS/061/MOD11A2")
            .filterDate(start_date, end_date)
            .filterBounds(roi)
            .select("LST_Day_1km")
            .mean()
            .multiply(0.02)
            .subtract(273.15)
        )

        palette = ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]
        viz_params = {"min": 20, "max": 50, "palette": palette}

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
                "min_temp": round(stats.get("LST_Day_1km_min", 0), 2),
                "max_temp": round(stats.get("LST_Day_1km_max", 0), 2),
                "mean_temp": round(stats.get("LST_Day_1km_mean", 0), 2),
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

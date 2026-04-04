from datetime import date
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, ValidationInfo, field_validator


BBox = Annotated[list[float], Field(min_length=4, max_length=4)]


class TemperatureStats(BaseModel):
    min_temp: float
    max_temp: float
    mean_temp: float


class HeatmapData(BaseModel):
    tile_url: str
    stats: TemperatureStats


class ProbeData(BaseModel):
    lat: float
    lon: float
    avg_temp: float
    anomaly_temp: float
    wind_speed: float


def _compute_bbox_area_km2(bbox: list[float]) -> float:
    min_lon, min_lat, max_lon, max_lat = bbox
    width_deg = max_lon - min_lon
    height_deg = max_lat - min_lat
    return width_deg * height_deg * 111 * 111


class HeatmapRequest(BaseModel):
    bbox: BBox
    start_date: date
    end_date: date
    mode: Literal["absolute", "anomaly"] = "absolute"

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: list[float]) -> list[float]:
        min_lon, min_lat, max_lon, max_lat = v
        if not (-180 <= min_lon < max_lon <= 180):
            raise ValueError("Invalid longitude range")
        if not (-90 <= min_lat < max_lat <= 90):
            raise ValueError("Invalid latitude range")
        area = _compute_bbox_area_km2(v)
        if area > 50_000:
            raise ValueError(f"Area {area:.0f} km² exceeds max 50,000 km²")
        return [round(x, 4) for x in v]

    @field_validator("start_date")
    @classmethod
    def validate_start_date(cls, v: date) -> date:
        if v < date(2013, 4, 1):
            raise ValueError(
                "start_date cannot be before 2013-04-01 (Landsat 8 launch)"
            )
        return v

    @field_validator("end_date")
    @classmethod
    def validate_end_date(cls, v: date, info: ValidationInfo) -> date:
        if "start_date" in info.data:
            delta = (v - info.data["start_date"]).days
            if delta <= 0:
                raise ValueError("end_date must be after start_date")
        return v


class ProbeRequest(BaseModel):
    lat: float
    lon: float
    start_date: date
    end_date: date

    @field_validator("lat")
    @classmethod
    def validate_lat(cls, v: float) -> float:
        if not (-90 <= v <= 90):
            raise ValueError("Invalid latitude")
        return round(v, 6)

    @field_validator("lon")
    @classmethod
    def validate_lon(cls, v: float) -> float:
        if not (-180 <= v <= 180):
            raise ValueError("Invalid longitude")
        return round(v, 6)

    @field_validator("start_date")
    @classmethod
    def validate_probe_start_date(cls, v: date) -> date:
        if v < date(2013, 4, 1):
            raise ValueError(
                "start_date cannot be before 2013-04-01 (Landsat 8 launch)"
            )
        return v

    @field_validator("end_date")
    @classmethod
    def validate_probe_end_date(cls, v: date, info: ValidationInfo) -> date:
        if "start_date" in info.data and v <= info.data["start_date"]:
            raise ValueError("end_date must be after start_date")
        return v


T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    error: str | None = None
    cached: bool = False

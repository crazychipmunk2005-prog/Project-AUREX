from datetime import date
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, Field, ValidationInfo, field_validator


BBox = Annotated[list[float], Field(min_length=4, max_length=4)]


class TemperatureStats(BaseModel):
    min_temp: float
    max_temp: float
    mean_temp: float


class HeatmapData(BaseModel):
    tile_url: str
    stats: TemperatureStats


def _compute_bbox_area_km2(bbox: list[float]) -> float:
    min_lon, min_lat, max_lon, max_lat = bbox
    width_deg = max_lon - min_lon
    height_deg = max_lat - min_lat
    return width_deg * height_deg * 111 * 111


class HeatmapRequest(BaseModel):
    bbox: BBox
    start_date: date
    end_date: date

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
        if v < date(2001, 1, 1):
            raise ValueError("start_date cannot be before 2001-01-01 (MODIS launch)")
        return v

    @field_validator("end_date")
    @classmethod
    def validate_end_date(cls, v: date, info: ValidationInfo) -> date:
        if "start_date" in info.data:
            delta = (v - info.data["start_date"]).days
            if delta <= 0:
                raise ValueError("end_date must be after start_date")
            if delta > 365:
                raise ValueError("Date range cannot exceed 365 days")
        return v


T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    error: str | None = None
    cached: bool = False

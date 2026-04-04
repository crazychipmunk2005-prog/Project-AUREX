from datetime import date

from pydantic import BaseModel, validator

from backend.models.heatmap import BBox


class TimeseriesRequest(BaseModel):
    bbox: BBox
    start_date: date
    end_date: date

    @validator("end_date")
    def end_after_start(cls, v: date, values: dict) -> date:
        if "start_date" in values and v <= values["start_date"]:
            raise ValueError("end_date must be after start_date")
        return v

    @validator("start_date")
    def start_not_before_landsat(cls, v: date) -> date:
        if v.year < 2013:
            raise ValueError("Landsat 8 data starts 2013-04-11")
        return v


class TimeseriesPoint(BaseModel):
    date: str
    temp: float


class TimeseriesData(BaseModel):
    series: list[TimeseriesPoint]
    image_count: int

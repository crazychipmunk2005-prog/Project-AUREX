from typing import Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gee_project_id: str = ""
    gee_service_account: str = ""
    gee_key_file: str = ""
    demo_mode: bool = False
    env: str = "development"
    allowed_origins: list[str] = ["http://localhost:3000"]
    rate_limit: str = "10/minute"
    internal_api_key: str = "dummy-api-key"
    redis_url: str = ""

    @model_validator(mode="after")
    def validate_gee_fields(self) -> "Settings":
        if self.demo_mode:
            return self

        missing = []
        if not self.gee_project_id:
            missing.append("GEE_PROJECT_ID")
        if not self.gee_service_account:
            missing.append("GEE_SERVICE_ACCOUNT")
        if not self.gee_key_file:
            missing.append("GEE_KEY_FILE")

        if missing:
            raise ValueError(
                "Missing required GEE settings when DEMO_MODE=false: "
                + ", ".join(missing)
            )

        return self

    class Config:
        env_file = ".env"
        case_sensitive = False


cached_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global cached_settings
    if cached_settings is None:
        cached_settings = Settings()
    return cached_settings

from pathlib import Path
from typing import Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gee_project_id: str = ""
    gee_service_account: str = ""
    gee_key_file: str = ""
    gee_key_json: str = ""
    demo_mode: bool = False
    env: str = "development"
    allowed_origins: list[str] = ["http://localhost:3000"]
    rate_limit: str = "10/minute"
    gee_request_timeout_seconds: int = 45
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

        if not self.gee_key_file and not self.gee_key_json:
            missing.append("GEE_KEY_FILE or GEE_KEY_JSON")

        if missing:
            raise ValueError(
                "Missing required GEE settings when DEMO_MODE=false: "
                + ", ".join(missing)
            )

        return self

    @property
    def resolved_gee_key_file(self) -> str:
        if not self.gee_key_file:
            return ""

        key_path = Path(self.gee_key_file)
        if key_path.is_absolute():
            return str(key_path)

        return str((Path.cwd() / key_path).resolve())

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


cached_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global cached_settings
    if cached_settings is None:
        cached_settings = Settings()
    return cached_settings

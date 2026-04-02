from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gee_project_id: str = "dummy-project"
    gee_service_account: str = "dummy@service.com"
    gee_key_file: str = "dummy-key.json"
    env: str = "development"
    allowed_origins: list[str] = ["http://localhost:3000"]
    rate_limit: str = "10/minute"
    internal_api_key: str = "dummy-api-key"
    redis_url: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False


cached_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global cached_settings
    if cached_settings is None:
        cached_settings = Settings()
    return cached_settings

from fastapi import Header, HTTPException

from backend.config.settings import get_settings


async def verify_api_key(x_api_key: str = Header(...)) -> None:
    settings = get_settings()
    if x_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")

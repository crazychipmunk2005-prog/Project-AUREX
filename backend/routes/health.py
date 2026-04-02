from fastapi import APIRouter


router = APIRouter(prefix="")


@router.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "version": "1.0.0"}

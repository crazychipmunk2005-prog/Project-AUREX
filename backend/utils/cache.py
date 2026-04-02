import hashlib
import time
from typing import Any


_cache: dict[str, tuple[Any, float]] = {}

MAX_CACHE_ENTRIES = 500

CACHE_TTL_HEATMAP = 6 * 60 * 60
CACHE_TTL_TIMESERIES = 24 * 60 * 60
CACHE_TTL_LANDUSE = 24 * 60 * 60


def get(key: str) -> Any | None:
    item = _cache.get(key)
    if item is None:
        return None

    value, expiry = item
    if time.time() > expiry:
        del _cache[key]
        return None

    return value


def set(key: str, value: Any, ttl: int) -> None:
    if len(_cache) >= MAX_CACHE_ENTRIES:
        evict_count = max(1, int(MAX_CACHE_ENTRIES * 0.2))
        keys_by_soonest_expiry = sorted(_cache.items(), key=lambda item: item[1][1])
        for evict_key, _ in keys_by_soonest_expiry[:evict_count]:
            del _cache[evict_key]

    _cache[key] = (value, time.time() + ttl)


def make_cache_key(*parts: str) -> str:
    raw = ":".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

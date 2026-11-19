import json
from functools import lru_cache
from pathlib import Path
from typing import Any


_CONFIG_PATH = Path(__file__).with_name("campus_buildings.json")


@lru_cache(maxsize=1)
def campus_buildings() -> list[dict[str, Any]]:
    with _CONFIG_PATH.open(encoding="utf-8") as config_file:
        config = json.load(config_file)
    buildings = config.get("buildings")
    if not isinstance(buildings, list) or not buildings:
        raise RuntimeError("Campus building configuration must define buildings")
    return buildings


def building_by_key(key: str | None) -> dict[str, Any] | None:
    if not key:
        return None
    return next(
        (building for building in campus_buildings() if building["key"] == key),
        None,
    )

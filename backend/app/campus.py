import json
import re
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


def normalize_location(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.casefold()).split())


def building_by_key(key: str | None) -> dict[str, Any] | None:
    if not key:
        return None
    return next(
        (building for building in campus_buildings() if building["key"] == key),
        None,
    )


def match_building(value: str | None) -> dict[str, Any] | None:
    normalized = normalize_location(value)
    if not normalized:
        return None
    padded_value = f" {normalized} "
    matches = []
    for building in campus_buildings():
        aliases = [building["name"], *building.get("location_aliases", [])]
        for alias in aliases:
            normalized_alias = normalize_location(alias)
            if normalized_alias and f" {normalized_alias} " in padded_value:
                matches.append((len(normalized_alias), building))
    if not matches:
        return None
    return max(matches, key=lambda match: match[0])[1]


def match_floor(value: str | None, building: dict[str, Any]) -> str:
    normalized = normalize_location(value)
    padded_value = f" {normalized} "
    aliases = building.get("floor_aliases", {})
    matches = []
    for floor in building["floors"]:
        for alias in aliases.get(floor, []):
            normalized_alias = normalize_location(alias)
            if normalized_alias and f" {normalized_alias} " in padded_value:
                matches.append((len(normalized_alias), floor))
    return max(matches, default=(0, "Unknown"), key=lambda match: match[0])[1]

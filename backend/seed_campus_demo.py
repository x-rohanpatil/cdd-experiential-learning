"""Generate local Campus 3D demo complaints; insertion requires --apply."""

import argparse
import random
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import make_url

from app import models
from app.campus import campus_buildings
from app.database import DATABASE_URL, SessionLocal


MARKER_PREFIX = "[CampusFix demo v1 item "
SCENARIOS = [
    ("Electrical", "Classroom lights need repair", "Several ceiling lights are flickering or not turning on."),
    ("Plumbing", "Water tap is leaking", "The tap continues to drip after being turned off."),
    ("Furniture", "Desk needs attention", "A classroom desk is loose and should be checked for safe use."),
    ("Network", "Wi-Fi connection is unstable", "The campus network drops intermittently in this area."),
    ("AV Equipment", "Projector is not responding", "The display does not connect reliably to the room equipment."),
    ("Washroom", "Washroom fixture needs repair", "A fixture is damaged and needs routine maintenance."),
]


def build_complaints(count: int, staff_ids: list[int]) -> list[dict]:
    randomizer = random.Random(2026)
    buildings = campus_buildings()
    now = datetime.now(timezone.utc)
    records = []
    statuses = ["Reported", "Reported", "Submitted", "In Progress", "Resolved", "Closed"]
    for index in range(1, count + 1):
        building = buildings[(index - 1) % len(buildings)]
        floor = building["floors"][(index - 1) % len(building["floors"])]
        floor_label = "Ground floor" if floor == "Ground" else f"Floor {floor}"
        category, title, description = SCENARIOS[(index - 1) % len(SCENARIOS)]
        status = statuses[(index - 1) % len(statuses)]
        if status == "In Progress" and not staff_ids:
            status = "Reported"

        created_at = now - timedelta(
            days=randomizer.randint(1, 30),
            hours=randomizer.randint(0, 23),
        )
        resolved_at = None
        closed_at = None
        if status in {"Resolved", "Closed"}:
            resolved_at = min(
                created_at + timedelta(hours=randomizer.randint(2, 60)),
                now - timedelta(minutes=10),
            )
        if status == "Closed":
            closed_at = resolved_at

        marker = f"{MARKER_PREFIX}{index:03d}]"
        records.append({
            "title": f"[Demo] {title}",
            "description": f"{marker} {description}",
            "category": category,
            "location": f"{building['name']}, {floor_label}, Room {200 + index % 40}",
            "priority": randomizer.choice(["low", "medium", "medium", "high"]),
            "status": status,
            "created_at": created_at,
            "resolved_at": resolved_at,
            "closed_at": closed_at,
            "staff_id": randomizer.choice(staff_ids) if status == "In Progress" else None,
        })
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed CampusFix with local demo complaints.")
    parser.add_argument("--count", type=int, default=36, help="Number of demo complaints to prepare (1-250).")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Insert missing demo complaints into a localhost PostgreSQL database.",
    )
    args = parser.parse_args()
    if not 1 <= args.count <= 250:
        parser.error("--count must be between 1 and 250")

    if not args.apply:
        print(
            f"Dry run: would prepare {args.count} realistic demo complaints. "
            "No database changes were made. Use --apply to insert into local PostgreSQL."
        )
        return

    database_url = make_url(DATABASE_URL)
    if (
        database_url.drivername not in {"postgres", "postgresql", "postgresql+psycopg"}
        or database_url.host not in {"localhost", "127.0.0.1", "::1"}
    ):
        parser.error("--apply is restricted to a PostgreSQL database hosted on localhost.")

    marker_pattern = re.compile(r"^\[CampusFix demo v1 item (\d+)\]")
    with SessionLocal.begin() as db:
        existing_descriptions = db.query(models.Complaint.description).filter(
            models.Complaint.description.like(f"{MARKER_PREFIX}%")
        ).all()
        existing_ids = {
            int(match.group(1))
            for (description,) in existing_descriptions
            if (match := marker_pattern.match(description or ""))
        }
        staff_ids = [staff_id for (staff_id,) in db.query(models.Staff.id).all()]
        records = [
            record
            for record in build_complaints(args.count, staff_ids)
            if int(marker_pattern.match(record["description"]).group(1)) not in existing_ids
        ]
        db.add_all(models.Complaint(**record) for record in records)

    print(f"Inserted {len(records)} demo complaints; {args.count - len(records)} already existed.")


if __name__ == "__main__":
    main()

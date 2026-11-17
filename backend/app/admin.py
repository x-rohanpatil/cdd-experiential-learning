from collections import Counter, defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.activity import record_complaint_activity
from app.auth import hash_password
from app.campus import (
    building_by_key,
    campus_buildings,
    match_building,
    match_floor,
    normalize_location,
)
from app.database import get_db
from app.notifications import add_notification
from app.security import Principal, require_roles
from app.sla import UNRESOLVED_STATUSES

router = APIRouter(prefix="/admin", tags=["Admin"])
admin_only = require_roles("admin")
COMPLETED_STATUSES = {"Resolved", "Closed"}


def _validate_location_mapping(building_key: str | None, floor: str | None) -> None:
    if building_key is None:
        if floor is not None:
            raise HTTPException(status_code=400, detail="Choose a building before selecting a floor")
        return
    building = building_by_key(building_key)
    if building is None:
        raise HTTPException(status_code=400, detail="Unknown campus building")
    if floor is not None and floor not in building["floors"]:
        raise HTTPException(status_code=400, detail="Floor is not part of the selected building")


def _resolve_location(
    value: str,
    qr_locations: list[models.Location],
) -> tuple[dict | None, str]:
    normalized = normalize_location(value)
    padded_value = f" {normalized} "
    qr_matches = []
    for location in qr_locations:
        name = normalize_location(location.name)
        if not name or f" {name} " not in padded_value:
            continue
        building = building_by_key(location.building_key) or match_building(
            f"{location.name} {location.details or ''}"
        )
        if building is None:
            continue
        floor = (
            location.floor
            if location.floor in building["floors"]
            else match_floor(f"{value} {location.details or ''}", building)
        )
        qr_matches.append((len(name), building, floor))
    if qr_matches:
        _, building, floor = max(qr_matches, key=lambda match: match[0])
        return building, floor

    building = match_building(value)
    if building is None:
        return None, "Unknown"
    return building, match_floor(value, building)


def _average_hours(durations: list[float]) -> float | None:
    if not durations:
        return None
    return round(sum(durations) / len(durations), 2)


def _duration_hours(start: datetime, end: datetime) -> float | None:
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    elapsed = (end - start).total_seconds() / 3600
    return elapsed if elapsed >= 0 else None


@router.get("/complaints")
def view_all_complaints(
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    complaints = (
        db.query(models.Complaint)
        .order_by(models.Complaint.created_at.desc())
        .all()
    )
    return {"total": len(complaints), "complaints": complaints}


@router.get("/analytics/buildings")
def building_analytics(
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    buildings = campus_buildings()
    qr_locations = db.query(models.Location).all()
    metrics = {}
    for building in buildings:
        metrics[building["key"]] = {
            **building,
            "open_complaint_count": 0,
            "floor_counts": Counter({floor: 0 for floor in building["floors"]}),
            "category_counts": Counter(),
            "resolution_hours": [],
            "recent_complaints": [],
        }

    unmapped = Counter()
    open_total = 0
    resolution_hours = []
    complaints = (
        db.query(models.Complaint)
        .order_by(models.Complaint.created_at.desc(), models.Complaint.id.desc())
        .all()
    )
    for complaint in complaints:
        building, floor = _resolve_location(complaint.location, qr_locations)
        is_open = complaint.status in UNRESOLVED_STATUSES
        if is_open:
            open_total += 1
        duration = None
        if (
            complaint.status in COMPLETED_STATUSES
            and complaint.resolved_at is not None
        ):
            duration = _duration_hours(complaint.created_at, complaint.resolved_at)
            if duration is not None:
                resolution_hours.append(duration)
        if building is None:
            if is_open:
                unmapped[complaint.location] += 1
            continue

        item = metrics[building["key"]]
        if len(item["recent_complaints"]) < 8:
            item["recent_complaints"].append({
                "id": complaint.id,
                "title": complaint.title,
                "status": complaint.status,
                "category": complaint.category,
                "location": complaint.location,
                "priority": complaint.priority,
                "created_at": complaint.created_at,
                "floor": floor,
            })
        if is_open:
            item["open_complaint_count"] += 1
            item["floor_counts"][floor] += 1
            item["category_counts"][complaint.category] += 1

        if duration is not None:
            item["resolution_hours"].append(duration)

    result = []
    mapped_open_total = 0
    for building in buildings:
        item = metrics[building["key"]]
        mapped_open_total += item["open_complaint_count"]
        floor_counts = [
            {"floor": floor, "open_complaint_count": item["floor_counts"][floor]}
            for floor in building["floors"]
        ]
        if item["floor_counts"]["Unknown"]:
            floor_counts.append({
                "floor": "Unknown",
                "open_complaint_count": item["floor_counts"]["Unknown"],
            })
        result.append({
            "key": item["key"],
            "name": item["name"],
            "position": item["position"],
            "size": item["size"],
            "floors": item["floors"],
            "location_aliases": item["location_aliases"],
            "open_complaint_count": item["open_complaint_count"],
            "floor_counts": floor_counts,
            "category_counts": [
                {"category": category, "open_complaint_count": count}
                for category, count in sorted(
                    item["category_counts"].items(),
                    key=lambda entry: (-entry[1], entry[0]),
                )
            ],
            "average_resolution_hours": _average_hours(item["resolution_hours"]),
            "recent_complaints": item["recent_complaints"],
        })

    return {
        "generated_at": datetime.now(timezone.utc),
        "totals": {
            "open_complaints": open_total,
            "mapped_open_complaints": mapped_open_total,
            "unmapped_open_complaints": sum(unmapped.values()),
            "average_resolution_hours": _average_hours(resolution_hours),
        },
        "buildings": result,
        "unmapped_locations": [
            {"location": location, "open_complaint_count": count}
            for location, count in unmapped.most_common(10)
        ],
    }


@router.patch("/complaints/{complaint_id}/status")
def update_complaint_status(
    complaint_id: int,
    status: str,
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    allowed_statuses = ["Reported", "Submitted", "Assigned", "In Progress"]
    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Admin cannot mark a task resolved without staff proof of fix",
        )
    complaint = db.query(models.Complaint).filter(
        models.Complaint.id == complaint_id
    ).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.status in ("Resolved", "Closed"):
        raise HTTPException(
            status_code=409,
            detail="Resolved complaints must follow student verification",
        )
    if status == "Assigned" and complaint.staff_id is None:
        raise HTTPException(
            status_code=409,
            detail="Assign the complaint to a staff member before setting Assigned",
        )
    previous_status = complaint.status
    complaint.status = status
    if previous_status != status:
        record_complaint_activity(
            db,
            complaint.id,
            kind="status_change",
            actor_role="admin",
            message=f"An administrator updated the status to {status}.",
            from_status=previous_status,
            to_status=status,
        )
    db.commit()
    db.refresh(complaint)
    return {
        "message": "Status updated",
        "complaint_id": complaint.id,
        "status": complaint.status,
    }


@router.post("/staff")
def create_staff(
    name: str,
    employee_id: str,
    department: str,
    phone: str = "",
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    existing = db.query(models.Staff).filter(
        models.Staff.employee_id == employee_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Employee ID already exists")

    staff = models.Staff(
        name=name,
        employee_id=employee_id,
        department=department,
        phone=phone,
    )
    db.add(staff)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail="Employee ID already exists") from error
    db.refresh(staff)
    return {
        "message": "Staff created; set up login credentials using /admin/staff/accounts",
        "id": staff.id,
        "name": staff.name,
        "employee_id": staff.employee_id,
    }


@router.post("/staff/accounts")
def create_staff_account(
    request: schemas.StaffCreate,
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    staff = db.query(models.Staff).filter(
        models.Staff.employee_id == request.employee_id
    ).first()
    if staff is not None:
        if staff.password_hash:
            raise HTTPException(status_code=409, detail="Staff account already has login credentials")
        staff.password_hash = hash_password(request.password)
    else:
        staff = models.Staff(
            name=request.name,
            employee_id=request.employee_id,
            department=request.department,
            phone=request.phone,
            password_hash=hash_password(request.password),
        )
        db.add(staff)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail="Employee ID already exists") from error
    db.refresh(staff)
    return {
        "id": staff.id,
        "name": staff.name,
        "employee_id": staff.employee_id,
        "department": staff.department,
    }


@router.get("/complaints/{complaint_id}/escalations")
def complaint_escalations(
    complaint_id: int,
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    complaint = db.get(models.Complaint, complaint_id)
    if complaint is None:
        raise HTTPException(status_code=404, detail="Complaint not found")
    history = (
        db.query(models.EscalationHistory)
        .filter(models.EscalationHistory.complaint_id == complaint_id)
        .order_by(models.EscalationHistory.level)
        .all()
    )
    return {
        "complaint_id": complaint_id,
        "history": [
            {"level": event.level, "target": event.target, "created_at": event.created_at}
            for event in history
        ],
    }


@router.get("/staff")
def list_staff(
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    staff = db.query(models.Staff).order_by(models.Staff.name).all()
    return {
        "total": len(staff),
        "staff": [
            {
                "id": person.id,
                "name": person.name,
                "employee_id": person.employee_id,
                "department": person.department,
                "phone": person.phone,
            }
            for person in staff
        ],
    }


@router.patch("/complaints/{complaint_id}/assign")
def assign_complaint(
    complaint_id: int,
    staff_id: int,
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.id == complaint_id
    ).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.status not in ("Reported", "Submitted", "Assigned"):
        raise HTTPException(status_code=409, detail="Only reported complaints can be assigned")
    staff = db.query(models.Staff).filter(models.Staff.id == staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    previous_status = complaint.status
    complaint.staff_id = staff.id
    complaint.status = "Assigned"
    record_complaint_activity(
        db,
        complaint.id,
        kind="assignment",
        actor_role="admin",
        message="Assigned to the maintenance team.",
        from_status=previous_status,
        to_status="Assigned",
    )
    add_notification(
        db,
        target_role="staff",
        target_user_id=staff.id,
        complaint_id=complaint.id,
        kind="assignment",
        message=f"Complaint #{complaint.id} has been assigned to you.",
    )
    db.commit()
    db.refresh(complaint)
    return {
        "message": "Complaint assigned successfully",
        "complaint_id": complaint.id,
        "staff_id": staff.id,
        "status": complaint.status,
    }


@router.post("/locations")
def create_location(
    request: schemas.LocationCreate,
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    _validate_location_mapping(request.building_key, request.floor)
    location = models.Location(
        name=request.name.strip(),
        details=request.details,
        building_key=request.building_key,
        floor=request.floor,
    )
    db.add(location)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Location already exists") from error
    db.refresh(location)
    return {
        "id": location.id,
        "name": location.name,
        "details": location.details,
        "building_key": location.building_key,
        "floor": location.floor,
    }


@router.patch("/locations/{location_id}/mapping")
def update_location_mapping(
    location_id: int,
    request: schemas.LocationMappingUpdate,
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    _validate_location_mapping(request.building_key, request.floor)
    location = db.get(models.Location, location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    location.building_key = request.building_key
    location.floor = request.floor
    db.commit()
    return {
        "id": location.id,
        "name": location.name,
        "building_key": location.building_key,
        "floor": location.floor,
    }


@router.get("/locations")
def list_locations(
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    locations = db.query(models.Location).order_by(models.Location.name).all()
    return {
        "locations": [
            {
                "id": item.id,
                "name": item.name,
                "details": item.details,
                "building_key": item.building_key,
                "floor": item.floor,
            }
            for item in locations
        ]
    }


@router.get("/departments/counts")
def department_counts(
    db: Session = Depends(get_db),
    _: Principal = Depends(admin_only),
):
    from sqlalchemy import func

    counts = (
        db.query(models.Student.department, func.count(models.Student.id))
        .filter(models.Student.department.is_not(None))
        .group_by(models.Student.department)
        .order_by(models.Student.department)
        .all()
    )
    return {"departments": [{"department": department, "count": count} for department, count in counts]}

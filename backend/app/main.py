import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.activity import record_complaint_activity
from app.admin import router as admin_router
from app.ai import categorize_complaint
from app.auth import hash_password, verify_password
from app.cors import allowed_origins
from app.database import SessionLocal, get_db
from app.notifications import add_notification
from app.security import (
    Principal,
    issue_access_token,
    require_roles,
    verify_admin_credentials,
)
from app.statuses import (
    ASSIGNED,
    CLOSED,
    COMPLAINT_TRANSITIONS,
    IN_PROGRESS,
    RESOLVED,
    STUDENT_EDITABLE_STATUSES,
)
from app.sla import SLA_HOURS, deadline_for, run_sla_cycle
from app.uploads import delete_image, get_image, read_image, save_image

logger = logging.getLogger(__name__)
SLA_SCAN_INTERVAL_SECONDS = 15 * 60
VERIFICATION_WINDOW = timedelta(hours=48)
PRIORITY_ORDER = ("low", "medium", "high", "critical")


def _run_sla_cycle() -> None:
    with SessionLocal() as db:
        run_sla_cycle(db)


async def _sla_worker() -> None:
    while True:
        await asyncio.sleep(SLA_SCAN_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(_run_sla_cycle)
        except Exception:
            logger.exception("CampusFix SLA cycle failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_sla_worker())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="CampusFix API",
    description="Smart Campus Maintenance Management System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(admin_router)


@app.get("/")
def home():
    return {"message": "Welcome to CampusFix API", "status": "Running"}


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "healthy", "application": "CampusFix"}


@app.post("/students/register", response_model=schemas.StudentResponse)
def register_student(student: schemas.StudentRegister, db: Session = Depends(get_db)):
    admission = (
        db.query(models.Student)
        .filter(models.Student.usn == student.usn)
        .with_for_update()
        .first()
    )
    if not admission:
        raise HTTPException(
            status_code=400,
            detail="USN was not found in the admission records.",
        )
    if admission.password_hash:
        raise HTTPException(
            status_code=400,
            detail="An account already exists for this USN.",
        )

    admission.password_hash = hash_password(student.password)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="An account already exists for this USN.",
        ) from error
    db.refresh(admission)
    return admission


@app.post("/students/login")
def login_student(credentials: schemas.StudentLogin, db: Session = Depends(get_db)):
    student = (
        db.query(models.Student)
        .filter(models.Student.usn == credentials.usn)
        .first()
    )
    if (
        not student
        or not student.password_hash
        or not verify_password(credentials.password, student.password_hash)
    ):
        raise HTTPException(status_code=401, detail="Invalid USN or password")

    return {
        "message": "Login successful",
        "access_token": issue_access_token("student", student.id, student.usn),
        "token_type": "bearer",
        "student": {"id": student.id, "name": student.name, "usn": student.usn},
    }


@app.post("/auth/login")
def login_staff_or_admin(credentials: schemas.LoginRequest, db: Session = Depends(get_db)):
    if credentials.role == "admin":
        if not os.getenv("ADMIN_USERNAME") or not os.getenv("ADMIN_PASSWORD"):
            raise HTTPException(status_code=503, detail="Admin login is not configured")
        if not verify_admin_credentials(credentials.username, credentials.password):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        return {
            "access_token": issue_access_token("admin", None, credentials.username),
            "token_type": "bearer",
            "user": {"role": "admin", "name": credentials.username},
        }

    staff = (
        db.query(models.Staff)
        .filter(models.Staff.employee_id == credentials.username)
        .first()
    )
    if (
        not staff
        or not staff.password_hash
        or not verify_password(credentials.password, staff.password_hash)
    ):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {
        "access_token": issue_access_token("staff", staff.id, staff.employee_id),
        "token_type": "bearer",
        "user": {"id": staff.id, "role": "staff", "name": staff.name},
    }


@app.post("/complaints/analyze")
async def analyze_complaint(
    title: str = Form(min_length=1, max_length=200),
    description: str = Form(min_length=1, max_length=10000),
    photo: UploadFile | None = File(default=None),
    _: Principal = Depends(require_roles("student")),
):
    image, mime_type = await read_image(photo)
    return await asyncio.to_thread(
        categorize_complaint,
        title,
        description,
        image,
        mime_type,
    )


def _create_complaint(
    complaint: schemas.ComplaintCreate,
    student: Principal,
    db: Session,
    photo: tuple[bytes, str] | None = None,
) -> models.Complaint:
    now = datetime.now(timezone.utc)
    if not complaint.suggested_team or not complaint.summary:
        image, mime_type = photo if photo else (None, None)
        suggestion = categorize_complaint(
            complaint.title,
            complaint.description,
            image,
            mime_type,
        )
        complaint = complaint.model_copy(update={
            "category": complaint.category or suggestion["category"],
            "priority": complaint.priority or suggestion["priority"],
            "suggested_team": complaint.suggested_team or suggestion["suggested_team"],
            "summary": complaint.summary or suggestion["summary"],
        })
    category = complaint.category or "Other"
    priority = complaint.priority or "medium"
    photo_path = save_image(*photo) if photo else None
    complaint_data = complaint.model_dump()
    complaint_data.update(category=category, priority=priority)
    row = models.Complaint(
        **complaint_data,
        student_id=student.user_id,
        status="Reported",
        created_at=now,
        due_at=deadline_for(category, now),
        before_photo_path=photo_path,
    )
    try:
        db.add(row)
        db.flush()
        record_complaint_activity(
            db,
            row.id,
            kind="submitted",
            actor_role="student",
            message="Your request was submitted.",
            to_status="Reported",
            created_at=now,
        )
        db.commit()
        db.refresh(row)
        return row
    except Exception:
        db.rollback()
        delete_image(photo_path)
        raise


def _visible_complaint_query(db: Session):
    return db.query(models.Complaint).filter(models.Complaint.deleted_at.is_(None))


def _editable_complaint(
    db: Session, complaint_id: int, principal: Principal
) -> models.Complaint:
    complaint = (
        _visible_complaint_query(db)
        .filter(models.Complaint.id == complaint_id)
        .with_for_update()
        .first()
    )
    if complaint is None or (
        principal.role == "student" and complaint.student_id != principal.user_id
    ):
        raise HTTPException(status_code=404, detail="Complaint not found")
    if principal.role == "staff":
        raise HTTPException(status_code=403, detail="Staff cannot edit complaint details")
    if complaint.status in (RESOLVED, CLOSED):
        raise HTTPException(status_code=409, detail="Resolved complaints cannot be edited")
    if principal.role == "student" and (
        complaint.status not in STUDENT_EDITABLE_STATUSES or complaint.staff_id is not None
    ):
        raise HTTPException(
            status_code=409,
            detail="You can edit a complaint before it is assigned to staff",
        )
    return complaint


@app.post("/complaints", response_model=schemas.ComplaintResponse)
def create_complaint(
    complaint: schemas.ComplaintCreate,
    student_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student")),
):
    if student_id is not None and student_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Cannot submit for another student")
    return _create_complaint(complaint, principal, db)


@app.post("/complaints/with-photo", response_model=schemas.ComplaintResponse)
async def create_complaint_with_photo(
    title: str = Form(min_length=1, max_length=200),
    description: str = Form(min_length=1, max_length=10000),
    location: str = Form(min_length=1, max_length=200),
    category: str | None = Form(default=None),
    priority: str | None = Form(default=None),
    suggested_team: str | None = Form(default=None),
    summary: str | None = Form(default=None),
    photo: UploadFile | None = File(default=None),
    student_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student")),
):
    if student_id is not None and student_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Cannot submit for another student")
    complaint = schemas.ComplaintCreate(
        title=title,
        description=description,
        location=location,
        category=category,
        priority=priority,
        suggested_team=suggested_team,
        summary=summary,
    )
    image, mime_type = await read_image(photo)
    photo_data = (image, mime_type) if image is not None and mime_type else None
    if not complaint.suggested_team or not complaint.summary:
        suggestion = await asyncio.to_thread(
            categorize_complaint,
            complaint.title,
            complaint.description,
            image,
            mime_type,
        )
        complaint = complaint.model_copy(update={
            "category": complaint.category or suggestion["category"],
            "priority": complaint.priority or suggestion["priority"],
            "suggested_team": complaint.suggested_team or suggestion["suggested_team"],
            "summary": complaint.summary or suggestion["summary"],
        })
    return _create_complaint(complaint, principal, db, photo_data)


@app.get("/complaints")
def get_complaints(
    db: Session = Depends(get_db),
    _: Principal = Depends(require_roles("admin")),
):
    complaints = _visible_complaint_query(db).order_by(models.Complaint.created_at.desc()).all()
    return {"total": len(complaints), "complaints": complaints}


@app.patch("/complaints/{complaint_id}", response_model=schemas.ComplaintResponse)
def update_complaint(
    complaint_id: int,
    request: schemas.ComplaintUpdate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "admin", "staff")),
):
    complaint = _editable_complaint(db, complaint_id, principal)
    changed = request.model_dump(exclude_unset=True)
    if not changed:
        raise HTTPException(status_code=400, detail="Provide at least one complaint field to update")
    for field, value in changed.items():
        if value is None:
            raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').capitalize()} cannot be empty")
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').capitalize()} cannot be empty")
        setattr(complaint, field, value)
    if "category" in changed:
        complaint.due_at = deadline_for(complaint.category, complaint.created_at)
    record_complaint_activity(
        db,
        complaint.id,
        kind="edited",
        actor_role=principal.role,
        message="The complaint details were updated.",
        created_at=datetime.now(timezone.utc),
    )
    db.commit()
    db.refresh(complaint)
    return complaint


@app.patch("/complaints/{complaint_id}/photo", response_model=schemas.ComplaintResponse)
async def update_complaint_photo(
    complaint_id: int,
    photo: UploadFile | None = File(default=None),
    remove_photo: bool = Form(default=False),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "admin", "staff")),
):
    complaint = _editable_complaint(db, complaint_id, principal)
    if (photo is None) == (not remove_photo):
        raise HTTPException(status_code=400, detail="Upload a replacement photo or request photo removal")
    old_path = complaint.before_photo_path
    new_path = None
    if photo is not None:
        image, mime_type = await read_image(photo)
        if image is None or mime_type is None:
            raise HTTPException(status_code=400, detail="A photo is required")
        new_path = save_image(image, mime_type)
    complaint.before_photo_path = new_path
    record_complaint_activity(
        db,
        complaint.id,
        kind="edited",
        actor_role=principal.role,
        message="The complaint photo was updated." if new_path else "The complaint photo was removed.",
        created_at=datetime.now(timezone.utc),
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_image(new_path)
        raise
    if old_path and old_path != new_path:
        try:
            delete_image(old_path)
        except Exception:
            logger.exception("Could not remove replaced complaint photo %s", old_path)
    db.refresh(complaint)
    return complaint


@app.delete("/complaints/{complaint_id}")
def delete_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "admin", "staff")),
):
    complaint = (
        _visible_complaint_query(db)
        .filter(models.Complaint.id == complaint_id)
        .with_for_update()
        .first()
    )
    if complaint is None or (
        principal.role == "student" and complaint.student_id != principal.user_id
    ):
        raise HTTPException(status_code=404, detail="Complaint not found")
    if principal.role == "staff":
        raise HTTPException(status_code=403, detail="Staff cannot delete complaints")
    if principal.role == "student" and (
        complaint.status not in STUDENT_EDITABLE_STATUSES or complaint.staff_id is not None
    ):
        raise HTTPException(
            status_code=409,
            detail="You can delete a complaint only before it is assigned to staff",
        )
    now = datetime.now(timezone.utc)
    record_complaint_activity(
        db,
        complaint.id,
        kind="deleted",
        actor_role=principal.role,
        message="The complaint was removed from active views.",
        from_status=complaint.status,
        created_at=now,
    )
    complaint.deleted_at = now
    complaint.deleted_by_role = principal.role
    complaint.deleted_by_user_id = principal.user_id
    db.commit()
    return {"complaint_id": complaint_id, "deleted": True}


@app.get(
    "/complaints/{complaint_id}/activity",
    response_model=list[schemas.ComplaintActivityResponse],
)
def get_complaint_activity(
    complaint_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "staff", "admin")),
):
    complaint = _visible_complaint_query(db).filter(models.Complaint.id == complaint_id).first()
    if complaint is None or (
        principal.role == "student" and complaint.student_id != principal.user_id
    ) or (
        principal.role == "staff" and complaint.staff_id != principal.user_id
    ):
        raise HTTPException(status_code=404, detail="Complaint not found")

    return (
        db.query(models.ComplaintActivity)
        .filter(models.ComplaintActivity.complaint_id == complaint_id)
        .order_by(models.ComplaintActivity.created_at, models.ComplaintActivity.id)
        .all()
    )


def _student_confirmed_closure(db: Session, complaint_id: int) -> bool:
    latest_closure = (
        db.query(models.ComplaintActivity.actor_role)
        .filter(
            models.ComplaintActivity.complaint_id == complaint_id,
            models.ComplaintActivity.to_status == CLOSED,
        )
        .order_by(
            models.ComplaintActivity.created_at.desc(),
            models.ComplaintActivity.id.desc(),
        )
        .first()
    )
    return latest_closure is not None and latest_closure.actor_role == "student"


@app.get(
    "/complaints/{complaint_id}/feedback",
    response_model=schemas.ComplaintFeedbackStatus,
)
def get_complaint_feedback(
    complaint_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "admin")),
):
    complaint = _visible_complaint_query(db).filter(models.Complaint.id == complaint_id).first()
    if complaint is None or (
        principal.role == "student" and complaint.student_id != principal.user_id
    ):
        raise HTTPException(status_code=404, detail="Complaint not found")

    feedback = (
        db.query(models.ComplaintFeedback)
        .filter(models.ComplaintFeedback.complaint_id == complaint_id)
        .first()
    )
    return {
        "eligible": (
            principal.role == "student"
            and complaint.status == CLOSED
            and _student_confirmed_closure(db, complaint_id)
        ),
        "feedback": feedback,
    }


@app.post(
    "/complaints/{complaint_id}/feedback",
    response_model=schemas.ComplaintFeedbackResponse,
    status_code=201,
)
def submit_complaint_feedback(
    complaint_id: int,
    request: schemas.ComplaintFeedbackCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student")),
):
    complaint = (
        db.query(models.Complaint)
        .filter(
            models.Complaint.id == complaint_id,
            models.Complaint.student_id == principal.user_id,
            models.Complaint.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if complaint is None:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.status != CLOSED or not _student_confirmed_closure(db, complaint_id):
        raise HTTPException(
            status_code=409,
            detail="Feedback is available after you confirm the repair.",
        )
    existing = (
        db.query(models.ComplaintFeedback)
        .filter(models.ComplaintFeedback.complaint_id == complaint_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Feedback has already been submitted.")

    feedback = models.ComplaintFeedback(
        complaint_id=complaint_id,
        rating=request.rating,
        comment=request.comment,
    )
    db.add(feedback)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Feedback has already been submitted.",
        ) from error
    db.refresh(feedback)
    return feedback


@app.get("/students/{student_id}/complaints")
def get_student_complaints(
    student_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "admin")),
):
    if principal.role == "student" and student_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Cannot view another student's complaints")
    complaints = (
        db.query(models.Complaint)
        .filter(models.Complaint.student_id == student_id)
        .filter(models.Complaint.deleted_at.is_(None))
        .order_by(models.Complaint.created_at.desc())
        .all()
    )
    return {"total": len(complaints), "complaints": complaints}


@app.get("/staff/{staff_id}/complaints")
def get_staff_tasks(
    staff_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("staff", "admin")),
):
    if principal.role == "staff" and staff_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Cannot view another staff member's tasks")
    complaints = (
        db.query(models.Complaint)
        .filter(models.Complaint.staff_id == staff_id)
        .filter(models.Complaint.deleted_at.is_(None))
        .order_by(models.Complaint.due_at.asc())
        .all()
    )
    return {"total": len(complaints), "tasks": complaints}


@app.patch("/staff/{staff_id}/complaints/{complaint_id}/status")
async def staff_update_status(
    staff_id: int,
    complaint_id: int,
    status: str = Query(),
    after_photo: UploadFile | None = File(default=None),
    note: str | None = Form(default=None, max_length=2000),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("staff")),
):
    if staff_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Cannot update another staff member's task")
    if status not in (IN_PROGRESS, RESOLVED):
        raise HTTPException(status_code=400, detail="Staff can set status to In Progress or Resolved")
    complaint = (
        db.query(models.Complaint)
        .filter(
            models.Complaint.id == complaint_id,
            models.Complaint.staff_id == staff_id,
            models.Complaint.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if complaint is None:
        raise HTTPException(status_code=404, detail="Assigned complaint not found")
    if status == IN_PROGRESS and complaint.status not in (ASSIGNED, IN_PROGRESS):
        raise HTTPException(status_code=409, detail="Only assigned tasks can be started or continued")
    if status != complaint.status and status not in COMPLAINT_TRANSITIONS.get(complaint.status, frozenset()):
        raise HTTPException(
            status_code=409,
            detail="This complaint cannot make that status transition",
        )

    photo_data = await read_image(after_photo)
    if status == RESOLVED and (photo_data[0] is None or not note or not note.strip()):
        raise HTTPException(
            status_code=400,
            detail="An after photo and resolution note are required to resolve a task",
        )

    new_photo_path = save_image(*photo_data) if photo_data[0] and photo_data[1] else None
    now = datetime.now(timezone.utc)
    previous_status = complaint.status
    complaint.status = status
    if previous_status != status:
        record_complaint_activity(
            db,
            complaint.id,
            kind="status_change",
            actor_role="staff",
            message=(
                "Work has started on this request."
                if status == IN_PROGRESS
                else "The repair was marked complete. Please confirm it works."
            ),
            from_status=previous_status,
            to_status=status,
            created_at=now,
        )
    if status == RESOLVED:
        complaint.after_photo_path = new_photo_path
        complaint.resolution_note = note.strip()
        complaint.resolved_at = now
        complaint.verification_deadline = now + VERIFICATION_WINDOW
        add_notification(
            db,
            target_role="student",
            target_user_id=complaint.student_id,
            complaint_id=complaint.id,
            kind="verification",
            message=f"Is complaint #{complaint.id} fixed? Confirm or reopen it within 48 hours.",
        )
    else:
        complaint.resolved_at = None
        complaint.verification_deadline = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_image(new_photo_path)
        raise
    db.refresh(complaint)
    return {"message": "Task status updated", "complaint_id": complaint.id, "status": complaint.status}


@app.post("/students/{student_id}/complaints/{complaint_id}/verification")
def verify_resolution(
    student_id: int,
    complaint_id: int,
    request: schemas.VerificationRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student")),
):
    if principal.user_id != student_id:
        raise HTTPException(status_code=403, detail="Cannot verify another student's complaint")
    complaint = (
        db.query(models.Complaint)
        .filter(
            models.Complaint.id == complaint_id,
            models.Complaint.student_id == student_id,
            models.Complaint.status == RESOLVED,
            models.Complaint.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if complaint is None:
        raise HTTPException(status_code=404, detail="Complaint awaiting verification not found")
    now = datetime.now(timezone.utc)
    previous_status = complaint.status
    verification_deadline = complaint.verification_deadline
    if verification_deadline and verification_deadline.tzinfo is None:
        verification_deadline = verification_deadline.replace(tzinfo=timezone.utc)
    if verification_deadline and verification_deadline <= now:
        complaint.status = CLOSED
        complaint.closed_at = now
    elif request.action == "confirm":
        complaint.status = CLOSED
        complaint.closed_at = now
    else:
        complaint.status = IN_PROGRESS
        complaint.resolved_at = None
        complaint.verification_deadline = None
        complaint.closed_at = None
        current_priority = complaint.priority.lower()
        if current_priority not in PRIORITY_ORDER:
            raise HTTPException(
                status_code=409,
                detail="Complaint priority cannot be escalated automatically",
            )
        complaint.priority = PRIORITY_ORDER[
            min(PRIORITY_ORDER.index(current_priority) + 1, len(PRIORITY_ORDER) - 1)
        ]
    record_complaint_activity(
        db,
        complaint.id,
        kind="status_change",
        actor_role=(
            "system"
            if verification_deadline and verification_deadline <= now
            else "student"
        ),
        message=(
            "Closed after the 48-hour confirmation period."
            if verification_deadline and verification_deadline <= now
            else (
                "You confirmed that the repair is complete."
                if request.action == "confirm"
                else "You asked the maintenance team to take another look."
            )
        ),
        from_status=previous_status,
        to_status=complaint.status,
        created_at=now,
    )
    db.commit()
    db.refresh(complaint)
    return {"complaint_id": complaint.id, "status": complaint.status, "priority": complaint.priority}


@app.get("/notifications", response_model=list[schemas.NotificationResponse])
def get_notifications(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "staff", "admin")),
):
    query = db.query(models.Notification).outerjoin(
        models.Complaint, models.Notification.complaint_id == models.Complaint.id
    ).filter(
        (models.Notification.complaint_id.is_(None))
        | (models.Complaint.deleted_at.is_(None))
    )
    if principal.role == "admin":
        query = query.filter(models.Notification.target_role == "admin")
    else:
        query = query.filter(
            (models.Notification.target_role == principal.role)
            & (models.Notification.target_user_id == principal.user_id)
        )
    return query.order_by(models.Notification.created_at.desc()).limit(100).all()


@app.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "staff", "admin")),
):
    query = db.query(models.Notification).filter(models.Notification.id == notification_id)
    if principal.role == "admin":
        query = query.filter(models.Notification.target_role == "admin")
    else:
        query = query.filter(
            models.Notification.target_role == principal.role,
            models.Notification.target_user_id == principal.user_id,
        )
    notification = query.first()
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read = True
    db.commit()
    return {"id": notification.id, "read": True}


@app.get("/media/{filename}")
def get_complaint_photo(
    filename: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_roles("student", "staff", "admin")),
):
    query = db.query(models.Complaint).filter(
        models.Complaint.deleted_at.is_(None),
        (models.Complaint.before_photo_path == filename)
        | (models.Complaint.after_photo_path == filename)
    )
    if principal.role == "student":
        query = query.filter(models.Complaint.student_id == principal.user_id)
    elif principal.role == "staff":
        query = query.filter(models.Complaint.staff_id == principal.user_id)
    if query.first() is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    image = get_image(filename)
    if image is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    contents, mime_type = image
    return Response(content=contents, media_type=mime_type)


@app.get("/locations")
def list_locations(
    db: Session = Depends(get_db),
    _: Principal = Depends(require_roles("student", "admin")),
):
    return db.query(models.Location).order_by(models.Location.name).all()


@app.get("/sla-config")
def get_sla_config(_: Principal = Depends(require_roles("student", "staff", "admin"))):
    return {"hours_by_category": SLA_HOURS}

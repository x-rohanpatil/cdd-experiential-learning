from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app import models


def record_complaint_activity(
    db: Session,
    complaint_id: int,
    *,
    kind: str,
    actor_role: str,
    message: str,
    from_status: str | None = None,
    to_status: str | None = None,
    created_at: datetime | None = None,
) -> None:
    activity = models.ComplaintActivity(
        complaint_id=complaint_id,
        kind=kind,
        actor_role=actor_role,
        message=message,
        from_status=from_status,
        to_status=to_status,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(activity)

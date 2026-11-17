import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.ai import FALLBACK_SUGGESTION
from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "test-only-signing-secret-for-campusfix")
    monkeypatch.setenv("ADMIN_USERNAME", "test-admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-password")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_STORAGE_BUCKET", raising=False)
    monkeypatch.setattr(
        "app.main.categorize_complaint",
        lambda *args, **kwargs: FALLBACK_SUGGESTION.copy(),
    )
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )
    Base.metadata.create_all(bind=engine)
    with testing_session() as db:
        db.add_all([
            models.Student(name="Test Student", usn="TEST001", department="CSE"),
            models.Student(name="Test Student", usn="TEST002", department="CSE"),
        ])
        db.commit()

    def override_get_db():
        with testing_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _student_headers(client, usn):
    response = client.post(
        "/students/login",
        json={"usn": usn, "password": "Test@12345"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _admin_headers(client):
    response = client.post(
        "/auth/login",
        json={
            "role": "admin",
            "username": "test-admin",
            "password": "test-admin-password",
        },
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_student_registration_and_login(client):
    register_response = client.post(
        "/students/register",
        json={"usn": " test001 ", "password": "Test@12345"},
    )
    assert register_response.status_code == 200
    assert register_response.json()["name"] == "Test Student"
    assert register_response.json()["department"] == "CSE"
    assert register_response.json()["year"] is None

    duplicate_response = client.post(
        "/students/register",
        json={"usn": "TEST001", "password": "Another@123"},
    )
    assert duplicate_response.status_code == 400

    login_response = client.post(
        "/students/login",
        json={"usn": "TEST001", "password": "Test@12345"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["message"] == "Login successful"
    assert login_response.json()["access_token"]


def test_unlisted_usn_cannot_register(client):
    response = client.post(
        "/students/register",
        json={"usn": "UNKNOWN001", "password": "Test@12345"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "USN was not found in the admission records."


def test_complaint_assignment_and_proof_of_fix(client):
    student_registration = client.post(
        "/students/register",
        json={"usn": "TEST002", "password": "Test@12345"},
    )
    student_id = student_registration.json()["id"]
    student_headers = _student_headers(client, "TEST002")
    complaint_response = client.post(
        f"/complaints?student_id={student_id}",
        headers=student_headers,
        json={
            "title": "Classroom light not working",
            "description": "Two lights are not working.",
            "category": "Electrical",
            "location": "Block A, Room 204",
            "priority": "medium",
        },
    )
    assert complaint_response.status_code == 200
    complaint = complaint_response.json()
    assert complaint["status"] == "Reported"
    assert complaint["due_at"]
    complaint_id = complaint["id"]
    initial_activity = client.get(
        f"/complaints/{complaint_id}/activity",
        headers=student_headers,
    )
    assert initial_activity.status_code == 200
    assert initial_activity.json()[0]["message"] == "Your request was submitted."

    admin_headers = _admin_headers(client)
    staff_response = client.post(
        "/admin/staff/accounts",
        headers=admin_headers,
        json={
            "name": "Rohan",
            "employee_id": "EMP001",
            "department": "Electrical",
            "phone": "123456789",
            "password": "StaffPassword@123",
        },
    )
    assert staff_response.status_code == 200
    staff_id = staff_response.json()["id"]
    assign_response = client.patch(
        f"/admin/complaints/{complaint_id}/assign",
        headers=admin_headers,
        params={"staff_id": staff_id},
    )
    assert assign_response.status_code == 200
    assigned_activity = client.get(
        f"/complaints/{complaint_id}/activity",
        headers=student_headers,
    )
    assert assigned_activity.json()[-1]["message"] == "Assigned to the maintenance team."

    staff_login = client.post(
        "/auth/login",
        json={
            "role": "staff",
            "username": "EMP001",
            "password": "StaffPassword@123",
        },
    )
    staff_headers = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}
    in_progress = client.patch(
        f"/staff/{staff_id}/complaints/{complaint_id}/status",
        headers=staff_headers,
        params={"status": "In Progress"},
    )
    assert in_progress.status_code == 200
    tasks_response = client.get(
        f"/staff/{staff_id}/complaints",
        headers=staff_headers,
    )
    assert tasks_response.status_code == 200
    assert tasks_response.json()["total"] == 1

    missing_proof = client.patch(
        f"/staff/{staff_id}/complaints/{complaint_id}/status",
        headers=staff_headers,
        params={"status": "Resolved"},
        data={"note": "Replaced bulbs"},
    )
    assert missing_proof.status_code == 400

    resolved = client.patch(
        f"/staff/{staff_id}/complaints/{complaint_id}/status",
        headers=staff_headers,
        params={"status": "Resolved"},
        data={"note": "Replaced bulbs"},
        files={"after_photo": ("after.png", b"\x89PNG\r\n\x1a\nimage", "image/png")},
    )
    assert resolved.status_code == 200
    feedback_before_confirmation = client.post(
        f"/complaints/{complaint_id}/feedback",
        headers=student_headers,
        json={"rating": 5},
    )
    assert feedback_before_confirmation.status_code == 409
    notifications = client.get("/notifications", headers=student_headers)
    assert notifications.status_code == 200
    assert any(item["kind"] == "verification" for item in notifications.json())

    reopen = client.post(
        f"/students/{student_id}/complaints/{complaint_id}/verification",
        headers=student_headers,
        json={"action": "reopen"},
    )
    assert reopen.status_code == 200
    assert reopen.json()["status"] == "In Progress"
    assert reopen.json()["priority"] == "high"

    history = client.get(
        f"/students/{student_id}/complaints",
        headers=student_headers,
    )
    assert history.status_code == 200
    assert history.json()["complaints"][0]["status"] == "In Progress"
    activity = client.get(
        f"/complaints/{complaint_id}/activity",
        headers=student_headers,
    )
    assert [item["to_status"] for item in activity.json()] == [
        "Reported",
        "Assigned",
        "In Progress",
        "Resolved",
        "In Progress",
    ]
    assert activity.json()[-1]["message"] == "You asked the maintenance team to take another look."

    resolved_again = client.patch(
        f"/staff/{staff_id}/complaints/{complaint_id}/status",
        headers=staff_headers,
        params={"status": "Resolved"},
        data={"note": "Replaced the bulbs and tested the lights."},
        files={"after_photo": ("after.png", b"\x89PNG\r\n\x1a\nimage", "image/png")},
    )
    assert resolved_again.status_code == 200
    confirmation = client.post(
        f"/students/{student_id}/complaints/{complaint_id}/verification",
        headers=student_headers,
        json={"action": "confirm"},
    )
    assert confirmation.status_code == 200
    assert confirmation.json()["status"] == "Closed"

    invalid_feedback = client.post(
        f"/complaints/{complaint_id}/feedback",
        headers=student_headers,
        json={"rating": 6},
    )
    assert invalid_feedback.status_code == 422
    feedback = client.post(
        f"/complaints/{complaint_id}/feedback",
        headers=student_headers,
        json={"rating": 5, "comment": "  Quick and helpful repair.  "},
    )
    assert feedback.status_code == 201
    assert feedback.json()["rating"] == 5
    assert feedback.json()["comment"] == "Quick and helpful repair."

    duplicate_feedback = client.post(
        f"/complaints/{complaint_id}/feedback",
        headers=student_headers,
        json={"rating": 4},
    )
    student_feedback = client.get(
        f"/complaints/{complaint_id}/feedback",
        headers=student_headers,
    )
    admin_feedback = client.get(
        f"/complaints/{complaint_id}/feedback",
        headers=admin_headers,
    )
    staff_feedback = client.get(
        f"/complaints/{complaint_id}/feedback",
        headers=staff_headers,
    )
    assert duplicate_feedback.status_code == 409
    assert student_feedback.json()["eligible"] is True
    assert student_feedback.json()["feedback"]["id"] == feedback.json()["id"]
    assert admin_feedback.json()["feedback"]["comment"] == "Quick and helpful repair."
    assert staff_feedback.status_code == 403


def test_complaint_activity_is_private_to_the_complaint_owner(client):
    registration = client.post(
        "/students/register",
        json={"usn": "TEST001", "password": "Test@12345"},
    )
    student_id = registration.json()["id"]
    owner_headers = _student_headers(client, "TEST001")
    other_registration = client.post(
        "/students/register",
        json={"usn": "TEST002", "password": "Test@12345"},
    )
    other_headers = _student_headers(client, "TEST002")
    complaint = client.post(
        f"/complaints?student_id={student_id}",
        headers=owner_headers,
        json={
            "title": "Water leak",
            "description": "There is a leak near the sink.",
            "category": "Plumbing",
            "location": "Block B, Room 10",
        },
    )
    complaint_id = complaint.json()["id"]

    denied = client.get(
        f"/complaints/{complaint_id}/activity",
        headers=other_headers,
    )
    admin_view = client.get(
        f"/complaints/{complaint_id}/activity",
        headers=_admin_headers(client),
    )

    assert other_registration.status_code == 200
    assert complaint.status_code == 200
    assert denied.status_code == 404
    assert admin_view.status_code == 200
    assert len(admin_view.json()) == 1
    private_feedback = client.get(
        f"/complaints/{complaint_id}/feedback",
        headers=other_headers,
    )
    assert private_feedback.status_code == 404


def test_admin_routes_require_admin_role(client):
    response = client.get("/admin/complaints")
    assert response.status_code == 401
    student_registration = client.post(
        "/students/register",
        json={"usn": "TEST001", "password": "Test@12345"},
    )
    assert student_registration.status_code == 200
    student_headers = _student_headers(client, "TEST001")
    forbidden = client.get("/admin/complaints", headers=student_headers)
    assert forbidden.status_code == 403


def test_complaint_photo_access_is_limited_to_owner(client):
    owner_registration = client.post(
        "/students/register",
        json={"usn": "TEST001", "password": "Test@12345"},
    )
    owner_id = owner_registration.json()["id"]
    owner_headers = _student_headers(client, "TEST001")
    other_registration = client.post(
        "/students/register",
        json={"usn": "TEST002", "password": "Test@12345"},
    )
    other_headers = _student_headers(client, "TEST002")
    complaint_response = client.post(
        f"/complaints/with-photo?student_id={owner_id}",
        headers=owner_headers,
        data={
            "title": "Broken light",
            "description": "Light is out",
            "location": "Room 1",
            "category": "Electrical",
            "priority": "medium",
            "suggested_team": "Electrical",
            "summary": "Light is out",
        },
        files={"photo": ("before.png", b"\x89PNG\r\n\x1a\nimage", "image/png")},
    )
    assert complaint_response.status_code == 200
    filename = complaint_response.json()["before_photo_path"]

    owner_photo = client.get(f"/media/{filename}", headers=owner_headers)
    other_photo = client.get(f"/media/{filename}", headers=other_headers)

    assert owner_photo.status_code == 200
    assert owner_photo.content == b"\x89PNG\r\n\x1a\nimage"
    assert owner_photo.headers["content-type"] == "image/png"
    assert other_photo.status_code == 404
    assert other_registration.status_code == 200

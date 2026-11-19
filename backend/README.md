# CampusFix Backend

Smart Campus Maintenance and Infrastructure Management System.

## Tech Stack
- Python
- FastAPI
- Uvicorn

## Run Locally
1. Start PostgreSQL from the repository root: `docker compose up -d db`.
2. Copy `.env.example` to `.env` in the `backend/` directory and set
   `DATABASE_URL`, `JWT_SECRET_KEY`, `ADMIN_USERNAME`, and
   `ADMIN_PASSWORD`. Keep the `.env` file private.
3. Create and activate a virtual environment, then install dependencies:
   `python -m pip install -r requirements.txt`.
4. Apply additive database migrations from the `backend/` directory:
   `python -m app.migrate`.
5. From the `backend/` directory, start the server:
   `python -m uvicorn app.main:app --reload`.

API Documentation: http://127.0.0.1:8000/docs

## Location and Floor Mapping
Administrators can map QR locations to the configured building and floor
options in `app/campus_buildings.json`. Location names, details, and mappings
are stored independently, so editing a location preserves its ID and QR URL.

The additive migration adds nullable deletion metadata to existing complaints
and adds any missing building/floor fields to QR locations. It preserves
existing rows. Apply it before using the updated location and complaint flows:

```powershell
python -m app.migrate
```

## Production schema migration
From a PowerShell session in the `backend/` directory, run:

```powershell
.\scripts\migrate_production.ps1
```

The script asks for the Supabase production `DATABASE_URL` with a secure
prompt. Alternatively, set `CAMPUSFIX_SUPABASE_DATABASE_URL` in the current
PowerShell process before running it. It accepts only the Supabase Session
Pooler hostname on port 5432, requires PostgreSQL credentials, a database
name, and TLS (`sslmode=require`, `verify-ca`, or `verify-full`), and suppresses
migration output to avoid exposing connection details. The migration performs
a read-only schema preflight before changes. Missing foreign keys are reported
for manual review; duplicate normalized USNs prevent it from adding USN
uniqueness. This script only migrates the schema; it does not import student
records.

## Transfer local admission records
After validating the Supabase schema and its unique `students.usn` constraint,
run the local-to-Supabase transfer from `backend/`:

```powershell
python .\transfer_local_students.py
```

This is a read-only dry run by default. It expects 1,168 local rows, validates
that USNs are unique after normalization, counts Supabase records, and reports
conflicting registration statuses by count. It reports only counts, never
student credentials or password hashes. The source
and target URLs are requested with hidden prompts unless
`CAMPUSFIX_SOURCE_DATABASE_URL` and `CAMPUSFIX_SUPABASE_DATABASE_URL` are set
in the current process. The source must be local/Docker PostgreSQL and the
target must be the Supabase Session Pooler on port 5432 with
`sslmode=require` or stricter. The script prompts for the local Docker
PostgreSQL URL first, then the production Supabase URL. Enter each URL only
when the script prompts; do not paste it at the PowerShell command prompt.
Plain `postgresql://` URLs are normalized to the installed psycopg 3 driver;
`postgresql+psycopg://` is also accepted.

Only after reviewing the dry-run counts, explicitly request the insert-only
transfer:

```powershell
python .\transfer_local_students.py --apply
```

The transfer copies USN, name, department, and password hash (without printing
or exporting hashes) so registration status is preserved for new rows. Existing
Supabase USNs are left unchanged, including any registration-status conflicts.
The insert transaction verifies imported/skipped and final record counts and
rolls back if its count checks fail. Parent names and other fields are not
selected. If the source count has intentionally changed, review it first and
specify the expected count explicitly with `--expected-count`.

## Containerized deployment
From the repository root, Compose builds the FastAPI backend and the production
Vite frontend, and starts them alongside PostgreSQL. The frontend is available
at `http://localhost:5173`, the API at `http://localhost:8000`, and PostgreSQL
at `localhost:5432`. All three host ports are bound to `127.0.0.1`; PostgreSQL
is not exposed on external network interfaces and must not be forwarded through
a Dev Tunnel.

The root `.env` supplies the existing PostgreSQL password. The backend's
private `backend/.env` is passed to the container at runtime for application
settings but is excluded from the image. Compose overrides its local
`DATABASE_URL` with the internal `db:5432` address. Set `VITE_API_URL` in the
root `.env` to the backend Dev Tunnel URL and `CORS_ORIGINS` to the exact
frontend Dev Tunnel origin. `VITE_API_URL` is passed as a Docker build argument
and embedded in the generated Vite bundle; changing it requires rebuilding the
frontend image. The defaults in `.env.example` contain the currently provided
Dev Tunnel URLs. PostgreSQL continues using the existing `postgres_data`
volume; do not remove that volume when managing the stack.

For Vite development outside Docker, `frontend/.env` should set `VITE_API_URL`
to the backend Dev Tunnel URL. Vite listens on `0.0.0.0:5173` and allows the
configured Dev Tunnel frontend hostname. FastAPI listens on `0.0.0.0:8000`
inside its container; its CORS middleware accepts the exact configured tunnel
origin and existing localhost development origins.

## Import Admission Records
From the `backend/` directory, validate the PDF without writing to the database:

```powershell
python import_admission_data.py "C:\path\to\Admission Portal 2026 (1).pdf" --dry-run
```

Import the validated admission records into the existing PostgreSQL database:

```powershell
python import_admission_data.py "C:\path\to\Admission Portal 2026 (1).pdf"
```

The importer is safe to rerun: existing USNs are left unchanged. Only USN,
student name, and department are populated; year, semester, and section remain
unset because they are not established by the admission PDF.

## Maintenance features
- Student complaints can be categorized with Gemini (`GEMINI_API_KEY`); if the
  key is absent or Gemini is unavailable, the API uses the `Other`/`medium`
  fallback. Complaint text and an optional image are sent to Gemini when
  categorization is requested.
- Photo uploads are stored under `UPLOAD_DIR` (default: `backend/uploads/`).
  Keep this directory on persistent storage and out of version control for
  local development. When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
  configured, complaint photos use the private Supabase bucket configured by
  `SUPABASE_STORAGE_BUCKET` (default: `campusfix-complaint-photos`). Create that
  bucket as private in Supabase before deploying. If only one of the URL and
  service-role key is configured, storage operations fail instead of silently
  switching to local files. Render deployments also fail closed when Supabase
  Storage credentials are missing. Existing local photo files are not copied
  automatically; preserve their filenames when transferring any needed files
  to the bucket before enabling Supabase Storage.
- Set `CORS_ORIGINS` to a comma-separated list of exact frontend origins, such
  as `https://campusfix.vercel.app,https://campusfix-git-feature.vercel.app`.
  The localhost development origins remain allowed.
- SLA targets are defined in `app/sla.py`. Background processing checks every
  15 minutes, escalates at the SLA deadline, then at 24 and 72 hours overdue,
  and auto-closes resolved complaints after 48 hours without student feedback.
  HOD/principal escalations are recorded and shown in the admin inbox.
- Admin credentials are configured only through `ADMIN_USERNAME` and
  `ADMIN_PASSWORD`. Admins create staff login accounts via the protected
  `/admin/staff/accounts` endpoint.
- JWTs are signed with `JWT_SECRET_KEY`; do not commit real credentials.

### Added API endpoints
- `POST /auth/login` — admin and maintenance-staff login.
- `POST /complaints/analyze` — Gemini suggestion (or fallback).
- `POST /complaints/with-photo` — submit with a before photo.
- `PATCH /complaints/{complaint_id}` and `/photo` — update an editable report.
- `DELETE /complaints/{complaint_id}` — soft-delete from active views.
- `POST /students/{student_id}/complaints/{complaint_id}/verification` — confirm
  or reopen a proof-of-fix request.
- `GET /complaints/{complaint_id}/activity` — chronological request updates,
  visible to the owner, assigned staff member, and admins.
- `GET/POST /complaints/{complaint_id}/feedback` — owner-only feedback after
  student-confirmed closure; admins can read submitted feedback.
- `GET /notifications` and `PATCH /notifications/{id}/read` — in-app notices.
- `GET /media/{filename}` — role/ownership-checked complaint photo.
- `GET /locations`, `GET/POST /admin/locations` — QR location records.
- `PATCH /admin/locations/{location_id}/mapping` — map a QR location to a
  configured campus building and floor.
- `PATCH /admin/locations/{location_id}` — edit a location name and details.
- `GET /admin/campus-buildings` — building and floor options for the location
  editor.
- `POST /admin/staff/accounts` — create a password-enabled staff account.
- `GET /sla-config` — current category SLA hours.
- `GET /admin/departments/counts` — department student counts.
- `GET /admin/complaints/{complaint_id}/escalations` — escalation history.

Admin complaint and staff management endpoints now require an admin bearer
token; staff task endpoints require the assigned staff member's token, and
student complaint endpoints require the complaint owner's token.

### Render environment variables
Configure these values in the Render backend service. Keep service-role and
Gemini keys on the backend only; never use `VITE_` prefixes for secrets.
- `DATABASE_URL` — PostgreSQL connection URL.
- `JWT_SECRET_KEY` — strong, private JWT signing secret.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` — initial admin login.
- `CORS_ORIGINS` — comma-separated exact Vercel frontend origins.
- `SUPABASE_URL` — Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — private Supabase service-role key.
- `SUPABASE_STORAGE_BUCKET` — private bucket name
  (`campusfix-complaint-photos`).
- `GEMINI_API_KEY` — optional backend-only Gemini key.

"""Copy local student admission rows to Supabase without overwriting existing rows."""

import argparse
import getpass
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import MetaData, Table, bindparam, create_engine, inspect, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import SQLAlchemyError

load_dotenv(Path(__file__).resolve().parent / ".env")

LOCAL_HOSTS = {
    "localhost",
    "127.0.0.1",
    "::1",
    "db",
    "postgres",
    "host.docker.internal",
}
EXPECTED_SOURCE_ROWS = 1168


class TransferSafetyError(Exception):
    pass


def _read_url(environment_name: str, database_label: str) -> str:
    value = os.getenv(environment_name)
    if value:
        return value
    value = getpass.getpass(
        f"{database_label} URL (hidden input; paste it here, not at the PowerShell prompt): "
    )
    if not value:
        raise TransferSafetyError(f"A {database_label.lower()} URL is required.")
    return value


def _parse_postgres_url(raw_url: str) -> tuple[URL, str]:
    try:
        url = make_url(raw_url)
    except Exception as error:
        raise TransferSafetyError(
            "The database URL is invalid; enter a PostgreSQL connection URL."
        ) from error

    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+psycopg")
    elif url.drivername != "postgresql+psycopg":
        raise TransferSafetyError(
            "Use postgresql:// or postgresql+psycopg://; the transfer requires psycopg 3."
        )
    if not url.host:
        raise TransferSafetyError("The PostgreSQL URL must include a host.")
    if not url.username or not url.password or not url.database:
        raise TransferSafetyError(
            "The PostgreSQL URL must include a username, password, and database name."
        )
    return url, url.host.rstrip(".").lower()


def _verify_hosts(source_url: URL, target_url: URL) -> None:
    source_host = (source_url.host or "").rstrip(".").lower()
    target_host = (target_url.host or "").rstrip(".").lower()
    if source_host not in LOCAL_HOSTS:
        raise TransferSafetyError(
            "Refusing to read the source: its host is not a recognized local/Docker host."
        )
    if re.fullmatch(r"aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com", target_host) is None:
        raise TransferSafetyError(
            "Refusing to write: the target must use a Supabase Session Pooler hostname."
        )
    if target_url.port != 5432:
        raise TransferSafetyError(
            "Refusing to write: the Supabase Session Pooler must use port 5432."
        )
    sslmode = target_url.query.get("sslmode")
    if not isinstance(sslmode, str) or sslmode.lower() not in {
        "require",
        "verify-ca",
        "verify-full",
    }:
        raise TransferSafetyError(
            "Refusing to write: the Supabase URL must specify sslmode=require or stricter."
        )


def _normalize_source_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    normalized_rows = []
    seen_usns = set()
    for row in rows:
        usn = (row["usn"] or "").strip().upper()
        name = (row["name"] or "").strip()
        department = (row["department"] or "").strip() or None
        if not usn or not name:
            raise TransferSafetyError(
                "The source contains a student without a USN or name; no rows were written."
            )
        if usn in seen_usns:
            raise TransferSafetyError(
                "The source contains duplicate USNs after normalization; no rows were written."
            )
        seen_usns.add(usn)
        normalized_rows.append({
            "usn": usn,
            "name": name,
            "department": department,
            "password_hash": row["password_hash"],
            "registered": _is_registered(row["password_hash"]),
        })
    return normalized_rows


def _load_source_rows(source_engine) -> list[dict[str, object]]:
    with source_engine.connect() as connection:
        result = connection.execute(text(
            "SELECT usn, name, department, password_hash "
            "FROM public.students ORDER BY usn"
        ))
        rows = [dict(row) for row in result.mappings()]

    return _normalize_source_rows(rows)


def _is_registered(password_hash: object) -> bool:
    return isinstance(password_hash, str) and bool(password_hash.strip())


def _require_usn_unique_index(target_engine) -> Table:
    inspector = inspect(target_engine)
    if not inspector.has_table("students", schema="public"):
        raise TransferSafetyError(
            "The Supabase public.students table does not exist; run the schema migration first."
        )

    unique_definitions = inspector.get_unique_constraints("students", schema="public")
    unique_indexes = inspector.get_indexes("students", schema="public")
    has_unique_usn = any(
        constraint.get("column_names") == ["usn"]
        for constraint in unique_definitions
    ) or any(
        index.get("unique") and index.get("column_names") == ["usn"]
        for index in unique_indexes
    )
    if not has_unique_usn:
        raise TransferSafetyError(
            "Supabase students.usn has no single-column unique constraint/index; no rows were written."
        )

    return Table("students", MetaData(), schema="public", autoload_with=target_engine)


def _count_target_students(connection) -> int:
    return connection.execute(
        text("SELECT count(*) FROM public.students")
    ).scalar_one()


def _existing_target_records(connection, usns: list[str]) -> dict[str, bool]:
    if not usns:
        return {}
    statement = text(
        """
        SELECT upper(btrim(usn)) AS normalized_usn,
               (password_hash IS NOT NULL AND btrim(password_hash) <> '') AS registered
        FROM public.students
        WHERE upper(btrim(usn)) IN :usns
        """
    ).bindparams(bindparam("usns", expanding=True))
    records: dict[str, bool] = {}
    for row in connection.execute(statement, {"usns": usns}):
        normalized_usn = row.normalized_usn
        if normalized_usn in records:
            raise TransferSafetyError(
                "Supabase contains duplicate normalized USNs among the source records; no rows were written."
            )
        records[normalized_usn] = bool(row.registered)
    return records


def _registration_conflict_count(
    source_rows: list[dict[str, object]],
    target_records: dict[str, bool],
) -> int:
    return sum(
        row["usn"] in target_records
        and bool(row["registered"]) != target_records[row["usn"]]
        for row in source_rows
    )


def _rows_to_insert(
    source_rows: list[dict[str, object]],
    target_records: dict[str, bool],
) -> list[dict[str, object]]:
    columns_to_transfer = ("usn", "name", "department", "password_hash")
    return [
        {column: row[column] for column in columns_to_transfer}
        for row in source_rows
        if row["usn"] not in target_records
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Insert new rows. Without this flag the script only performs a dry run.",
    )
    parser.add_argument(
        "--expected-count",
        type=int,
        default=EXPECTED_SOURCE_ROWS,
        help=f"Expected local source row count (default: {EXPECTED_SOURCE_ROWS}).",
    )
    args = parser.parse_args()

    source_url, _ = _parse_postgres_url(_read_url(
        "CAMPUSFIX_SOURCE_DATABASE_URL",
        "Local Docker PostgreSQL (source)",
    ))
    target_url, _ = _parse_postgres_url(_read_url(
        "CAMPUSFIX_SUPABASE_DATABASE_URL",
        "Supabase production Session Pooler (destination)",
    ))
    _verify_hosts(source_url, target_url)

    source_engine = create_engine(source_url, hide_parameters=True, pool_pre_ping=True)
    target_engine = create_engine(
        target_url,
        hide_parameters=True,
        pool_pre_ping=True,
    )
    try:
        source_rows = _load_source_rows(source_engine)
        if len(source_rows) != args.expected_count:
            raise TransferSafetyError(
                f"Expected {args.expected_count} local student rows but found {len(source_rows)}; "
                "no rows were written. Review the source and use --expected-count only if intentional."
            )

        target_students = _require_usn_unique_index(target_engine)
        source_usns = [row["usn"] for row in source_rows]
        with target_engine.connect() as connection:
            initial_target_count = _count_target_students(connection)
            existing_records = _existing_target_records(connection, source_usns)
        rows_to_insert = _rows_to_insert(source_rows, existing_records)
        status_conflicts = _registration_conflict_count(source_rows, existing_records)

        print(f"Local student rows validated: {len(source_rows)}")
        print(f"Local rows with a non-empty password hash: {sum(bool(row['registered']) for row in source_rows)}")
        print(f"Existing Supabase student records: {initial_target_count}")
        print(f"Source USNs already present in Supabase (will be left unchanged): {len(existing_records)}")
        print(f"Registration-status conflicts among existing USNs: {status_conflicts}")
        print(f"New rows eligible to insert: {len(rows_to_insert)}")

        if not args.apply:
            print("Dry run only; no database rows were written.")
            return 0

        with target_engine.connect().execution_options(
            isolation_level="SERIALIZABLE"
        ) as connection:
            with connection.begin():
                transaction_initial_count = _count_target_students(connection)
                current_records = _existing_target_records(connection, source_usns)
                current_status_conflicts = _registration_conflict_count(
                    source_rows, current_records
                )
                current_rows_to_insert = _rows_to_insert(source_rows, current_records)

                if current_rows_to_insert:
                    statement = (
                        pg_insert(target_students)
                        .values(current_rows_to_insert)
                        .on_conflict_do_nothing(index_elements=[target_students.c.usn])
                        .returning(target_students.c.usn)
                    )
                    inserted_usns = connection.execute(statement).scalars().all()
                else:
                    inserted_usns = []

                inserted_count = len(inserted_usns)
                final_target_count = _count_target_students(connection)
                final_source_count = connection.execute(
                    text(
                        "SELECT count(*) FROM public.students "
                        "WHERE upper(btrim(usn)) IN :usns"
                    ).bindparams(bindparam("usns", expanding=True)),
                    {"usns": source_usns},
                ).scalar_one()
                if final_target_count != transaction_initial_count + inserted_count:
                    raise TransferSafetyError(
                        "Destination count verification failed; the insert transaction was rolled back."
                    )
                if final_source_count != len(source_rows):
                    raise TransferSafetyError(
                        "Not all source USNs are present in Supabase; the insert transaction was rolled back."
                    )

        with target_engine.connect() as connection:
            committed_target_count = _count_target_students(connection)
            committed_source_count = connection.execute(
                text(
                    "SELECT count(*) FROM public.students "
                    "WHERE upper(btrim(usn)) IN :usns"
                ).bindparams(bindparam("usns", expanding=True)),
                {"usns": source_usns},
            ).scalar_one()
        if (
            committed_target_count != final_target_count
            or committed_source_count != len(source_rows)
        ):
            raise TransferSafetyError(
                "Post-commit destination verification failed; stop and review the Supabase records before retrying."
            )

        skipped_count = len(source_rows) - inserted_count
        print(f"Registration-status conflicts at apply time: {current_status_conflicts}")
        print(f"New student rows inserted: {inserted_count}")
        print(f"Source rows skipped (already present or concurrent conflict): {skipped_count}")
        print(f"Verified final Supabase student record count: {committed_target_count}")
        return 0
    finally:
        source_engine.dispose()
        target_engine.dispose()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except TransferSafetyError as error:
        print(f"Student transfer stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
    except SQLAlchemyError as error:
        print(
            f"Student transfer failed ({type(error).__name__}); connection details and row values were suppressed.",
            file=sys.stderr,
        )
        raise SystemExit(1)

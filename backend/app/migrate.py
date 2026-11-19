"""Apply additive, idempotent PostgreSQL migrations for CampusFix."""

from sqlalchemy import Column, inspect, text

from app.database import Base, engine
from app import models  # noqa: F401

COMPLAINT_COLUMNS = {
    "suggested_team": "VARCHAR(100)",
    "summary": "TEXT",
    "before_photo_path": "VARCHAR(255)",
    "after_photo_path": "VARCHAR(255)",
    "resolution_note": "TEXT",
    "due_at": "TIMESTAMPTZ",
    "escalation_level": "INTEGER NOT NULL DEFAULT 0",
    "resolved_at": "TIMESTAMPTZ",
    "verification_deadline": "TIMESTAMPTZ",
    "closed_at": "TIMESTAMPTZ",
    "deleted_at": "TIMESTAMPTZ",
    "deleted_by_role": "VARCHAR(20)",
    "deleted_by_user_id": "INTEGER",
}
SAFE_ADDITIVE_COLUMNS = {
    ("students", "department"): "VARCHAR(50)",
    ("students", "year"): "INTEGER",
    ("students", "semester"): "INTEGER",
    ("students", "section"): "VARCHAR(10)",
    ("students", "password_hash"): "VARCHAR(255)",
    ("staff", "phone"): "VARCHAR(15)",
    ("staff", "password_hash"): "VARCHAR(255)",
    ("locations", "building_key"): "VARCHAR(50)",
    ("locations", "floor"): "VARCHAR(40)",
}
SAFE_ADDITIVE_COLUMNS.update({
    ("complaints", name): definition
    for name, definition in COMPLAINT_COLUMNS.items()
})


def _preflight() -> tuple[int, bool, list[tuple[str, Column]]]:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names(schema="public"))
    missing_tables = sorted(set(Base.metadata.tables) - existing_tables)
    missing_required_columns: list[str] = []
    missing_columns: list[tuple[str, Column]] = []
    missing_foreign_keys: list[str] = []
    missing_indexes: list[str] = []

    for table_name, table in Base.metadata.tables.items():
        if table_name not in existing_tables:
            print(f"Preflight: table public.{table_name} is missing; create_all will create it.")
            continue

        actual_columns = {
            column["name"]
            for column in inspector.get_columns(table_name, schema="public")
        }
        for column in table.columns:
            if column.name in actual_columns:
                continue
            label = f"public.{table_name}.{column.name}"
            print(f"Preflight: missing column {label}.")
            missing_columns.append((table_name, column))
            if (
                not column.nullable
                and (table_name, column.name) not in SAFE_ADDITIVE_COLUMNS
            ):
                missing_required_columns.append(label)

        actual_foreign_keys = {
            (
                tuple(foreign_key.get("constrained_columns") or ()),
                foreign_key.get("referred_table"),
                tuple(foreign_key.get("referred_columns") or ()),
            )
            for foreign_key in inspector.get_foreign_keys(table_name, schema="public")
        }
        for foreign_key in table.foreign_key_constraints:
            expected = (
                tuple(element.parent.name for element in foreign_key.elements),
                foreign_key.elements[0].column.table.name,
                tuple(element.column.name for element in foreign_key.elements),
            )
            if expected not in actual_foreign_keys:
                label = f"public.{table_name} foreign key {expected[0]} -> {expected[1]}{expected[2]}"
                missing_foreign_keys.append(label)
                print(f"Preflight: missing foreign key {label}; it will not be added automatically.")

        actual_indexes = inspector.get_indexes(table_name, schema="public")
        actual_unique_constraints = inspector.get_unique_constraints(
            table_name, schema="public"
        )
        actual_primary_key = inspector.get_pk_constraint(table_name, schema="public")
        for index in table.indexes:
            columns = tuple(column.name for column in index.columns)
            is_present = any(
                tuple(item.get("column_names") or ()) == columns
                and bool(item.get("unique")) == bool(index.unique)
                for item in actual_indexes
            )
            if not is_present and index.unique:
                is_present = any(
                    tuple(item.get("column_names") or ()) == columns
                    for item in actual_unique_constraints
                )
            if not is_present and index.unique:
                is_present = tuple(actual_primary_key.get("constrained_columns") or ()) == columns
            if not is_present:
                label = f"public.{table_name} index {columns} (unique={bool(index.unique)})"
                missing_indexes.append(label)
                print(f"Preflight: missing {label}.")

    duplicate_usn_groups = 0
    has_unique_usn = False
    if "students" in existing_tables:
        student_columns = {
            column["name"]
            for column in inspector.get_columns("students", schema="public")
        }
        if "usn" in student_columns:
            with engine.connect() as connection:
                duplicate_usn_groups = connection.execute(text(
                    """
                    SELECT count(*)
                    FROM (
                        SELECT upper(btrim(usn))
                        FROM public.students
                        WHERE usn IS NOT NULL
                        GROUP BY upper(btrim(usn))
                        HAVING count(*) > 1
                    ) AS duplicate_groups
                    """
                )).scalar_one()

            has_unique_usn = any(
                item.get("unique")
                and tuple(item.get("column_names") or ()) == ("usn",)
                for item in inspector.get_indexes("students", schema="public")
            ) or any(
                tuple(item.get("column_names") or ()) == ("usn",)
                for item in inspector.get_unique_constraints("students", schema="public")
            )
            if duplicate_usn_groups:
                print(
                    "Preflight: found "
                    f"{duplicate_usn_groups} duplicate normalized USN group(s); "
                    "the migration will not add USN uniqueness."
                )
            elif not has_unique_usn:
                print(
                    "Preflight: students.usn is not unique; a unique index can be "
                    "added because no duplicate normalized USNs were found."
                )

    if missing_tables:
        print("Preflight: missing tables: " + ", ".join(
            f"public.{name}" for name in missing_tables
        ))
    if missing_required_columns:
        raise RuntimeError(
            "Preflight stopped before schema changes. Missing required columns "
            "cannot be added safely without a data backfill: "
            + ", ".join(missing_required_columns)
        )
    if missing_foreign_keys:
        print(
            f"Preflight: {len(missing_foreign_keys)} existing-table foreign key(s) "
            "are missing and require manual review."
        )
    if missing_indexes:
        print(f"Preflight: {len(missing_indexes)} model index(es) are missing.")

    return duplicate_usn_groups, has_unique_usn, missing_columns


def migrate() -> None:
    duplicate_usn_groups, _, missing_columns = _preflight()

    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
        for table_name, column in missing_columns:
            definition = SAFE_ADDITIVE_COLUMNS.get(
                (table_name, column.name),
                column.type.compile(dialect=connection.dialect),
            )
            connection.execute(text(
                f"ALTER TABLE public.{table_name} "
                f"ADD COLUMN IF NOT EXISTS {column.name} {definition}"
            ))
        connection.execute(
            text("ALTER TABLE public.complaints ALTER COLUMN priority SET DEFAULT 'medium'")
        )
        connection.execute(
            text("ALTER TABLE public.complaints ALTER COLUMN status SET DEFAULT 'Reported'")
        )

    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_complaints_due_at "
                "ON public.complaints (due_at)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_complaints_deleted_at "
                "ON public.complaints (deleted_at)"
            )
        )
        has_unique_usn = any(
            item.get("unique")
            and tuple(item.get("column_names") or ()) == ("usn",)
            for item in inspect(connection).get_indexes("students", schema="public")
        ) or any(
            tuple(item.get("column_names") or ()) == ("usn",)
            for item in inspect(connection).get_unique_constraints(
                "students", schema="public"
            )
        )
        if duplicate_usn_groups == 0 and not has_unique_usn:
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_usn ON public.students (usn)"
            ))


if __name__ == "__main__":
    migrate()
    print("CampusFix PostgreSQL migrations applied.")

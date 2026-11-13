import pytest

from transfer_local_students import (
    _is_registered,
    _normalize_source_rows,
    _parse_postgres_url,
    _read_url,
    _registration_conflict_count,
    _rows_to_insert,
    _verify_hosts,
    TransferSafetyError,
)

LOCAL_URLS = [
    "postgresql://local_user:local_password@localhost:5432/campusfix",
    "postgresql+psycopg://local_user:local_password@localhost:5432/campusfix",
]
SESSION_POOLER_URL = (
    "postgresql://pooler_user:pooler_password@"
    "aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require"
)


def test_registration_status_requires_a_nonempty_password_hash():
    assert _is_registered("argon2-hash")
    assert not _is_registered(None)
    assert not _is_registered("")
    assert not _is_registered("   ")


def test_registration_conflicts_compare_status_without_exposing_hashes():
    source_rows = [
        {"usn": "1AB26CS001", "registered": True},
        {"usn": "1AB26CS002", "registered": False},
        {"usn": "1AB26CS003", "registered": True},
    ]
    target_records = {
        "1AB26CS001": False,
        "1AB26CS002": False,
    }

    assert _registration_conflict_count(source_rows, target_records) == 1


@pytest.mark.parametrize("raw_url", LOCAL_URLS)
def test_plain_and_psycopg_postgres_urls_are_normalized_to_psycopg3(raw_url):
    url, host = _parse_postgres_url(raw_url)

    assert url.drivername == "postgresql+psycopg"
    assert host == "localhost"
    assert url.password == "local_password"


@pytest.mark.parametrize(
    "raw_url",
    [
        "mysql://user:password@localhost:3306/campusfix",
        "postgresql+psycopg2://user:password@localhost:5432/campusfix",
        "postgresql://localhost:5432/campusfix",
        "postgresql://user:password@localhost:5432",
    ],
)
def test_invalid_or_non_psycopg3_postgres_urls_are_rejected(raw_url):
    with pytest.raises(TransferSafetyError) as error:
        _parse_postgres_url(raw_url)

    assert "local_password" not in str(error.value)
    assert "user:password@" not in str(error.value)


def test_invalid_url_error_does_not_echo_input():
    secret_text = "postgresql://student:secret-value@"

    with pytest.raises(TransferSafetyError) as error:
        _parse_postgres_url(secret_text)

    assert secret_text not in str(error.value)
    assert "secret-value" not in str(error.value)


def test_local_source_and_tls_session_pooler_are_accepted():
    local_url, _ = _parse_postgres_url(LOCAL_URLS[0])
    target_url, _ = _parse_postgres_url(SESSION_POOLER_URL)

    _verify_hosts(local_url, target_url)


@pytest.mark.parametrize(
    "raw_target_url",
    [
        "postgresql://user:password@db.example.supabase.co:5432/postgres?sslmode=require",
        "postgresql://user:password@localhost:5432/postgres?sslmode=require",
        "postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require",
        "postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
        "postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=disable",
    ],
)
def test_target_requires_session_pooler_port_5432_and_tls(raw_target_url):
    local_url, _ = _parse_postgres_url(LOCAL_URLS[0])
    target_url, _ = _parse_postgres_url(raw_target_url)

    with pytest.raises(TransferSafetyError):
        _verify_hosts(local_url, target_url)


def test_local_source_rejects_non_local_hosts():
    source_url, _ = _parse_postgres_url(
        "postgresql://user:password@remote.example:5432/campusfix"
    )
    target_url, _ = _parse_postgres_url(SESSION_POOLER_URL)

    with pytest.raises(TransferSafetyError, match="source"):
        _verify_hosts(source_url, target_url)


def test_hidden_url_prompts_distinguish_local_source_and_production_target(monkeypatch):
    monkeypatch.delenv("CAMPUSFIX_SOURCE_DATABASE_URL", raising=False)
    monkeypatch.delenv("CAMPUSFIX_SUPABASE_DATABASE_URL", raising=False)
    prompts = []
    entered_urls = iter(["local-url", "production-url"])
    monkeypatch.setattr(
        "transfer_local_students.getpass.getpass",
        lambda prompt: prompts.append(prompt) or next(entered_urls),
    )

    source_url = _read_url(
        "CAMPUSFIX_SOURCE_DATABASE_URL",
        "Local Docker PostgreSQL (source)",
    )
    target_url = _read_url(
        "CAMPUSFIX_SUPABASE_DATABASE_URL",
        "Supabase production Session Pooler (destination)",
    )

    assert source_url == "local-url"
    assert target_url == "production-url"
    assert "Local Docker PostgreSQL" in prompts[0]
    assert "Supabase production Session Pooler" in prompts[1]
    assert all("hidden input" in prompt for prompt in prompts)


def test_duplicate_normalized_source_usns_are_rejected():
    rows = [
        {"usn": " 1ab26cs001 ", "name": "Student One", "department": "CS", "password_hash": None},
        {"usn": "1AB26CS001", "name": "Student One", "department": "CS", "password_hash": None},
    ]

    with pytest.raises(TransferSafetyError, match="duplicate USNs"):
        _normalize_source_rows(rows)


def test_existing_destination_rows_are_not_included_in_insert_payload():
    source_rows = [
        {
            "usn": "1AB26CS001",
            "name": "Student One",
            "department": "CS",
            "password_hash": "private-hash",
            "registered": True,
        },
        {
            "usn": "1AB26CS002",
            "name": "Student Two",
            "department": "EC",
            "password_hash": None,
            "registered": False,
        },
    ]

    insert_rows = _rows_to_insert(source_rows, {"1AB26CS001": False})

    assert insert_rows == [{
        "usn": "1AB26CS002",
        "name": "Student Two",
        "department": "EC",
        "password_hash": None,
    }]
    assert "registered" not in insert_rows[0]


def test_empty_hashes_are_unregistered_and_status_conflicts_are_counted():
    source_rows = _normalize_source_rows([
        {"usn": "1AB26CS001", "name": "One", "department": "CS", "password_hash": ""},
        {"usn": "1AB26CS002", "name": "Two", "department": "CS", "password_hash": "hash"},
    ])

    assert [row["registered"] for row in source_rows] == [False, True]
    assert _registration_conflict_count(
        source_rows,
        {"1AB26CS001": True, "1AB26CS002": True},
    ) == 1

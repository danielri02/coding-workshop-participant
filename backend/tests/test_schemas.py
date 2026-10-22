"""Request-validation and safe-serialization behavior without a database."""

import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from backend.app import schemas
from backend.app.models import IncidentPriority, IncidentStatus
from backend.app.schemas import (
    BuildingCreate,
    EngineerProfileCreate,
    FloorCreate,
    IncidentAdminUpdate,
    IncidentAssignment,
    IncidentCreate,
    IncidentPriorityUpdate,
    IncidentRead,
    IncidentStatusUpdate,
    NoteCreate,
    NoteUpdate,
    UserCreate,
)


class SchemaTests(unittest.TestCase):
    """Validate boundaries that will be used by future API routes."""

    def incident_data(self, **changes: object) -> dict[str, object]:
        """Supply a minimal valid report for individual boundary checks."""

        return {
            "title": "Flickering light",
            "description": "The lobby light flickers.",
            "category": "Electrical",
            "building_id": 1,
            **changes,
        }

    def user_data(self, **changes: object) -> dict[str, object]:
        """Supply registration input without relying on real credentials."""

        return {
            "name": "Employee",
            "email": "employee@acme.inc",
            "password": "p" * 16,
            **changes,
        }

    def test_registration_normalizes_email_and_name(self) -> None:
        """Equivalent employee identities have the same canonical email."""

        user = UserCreate(
            **self.user_data(name=" Employee ", email=" EMPLOYEE@ACME.INC ")
        )
        self.assertEqual(user.name, "Employee")
        self.assertEqual(user.email, "employee@acme.inc")
        self.assertNotIn("p" * 16, user.model_dump_json())

    def test_registration_rejects_invalid_or_noncompany_emails(self) -> None:
        """Domain suffix tricks, subdomains, and malformed emails are invalid."""

        for email in (
            "a@sub.acme.inc",
            "a@acme.inc.evil",
            "a@other.inc",
            "@acme.inc",
            "invalid",
        ):
            with self.subTest(email=email), self.assertRaises(ValidationError):
                UserCreate(**self.user_data(email=email))

    def test_registration_cannot_grant_capabilities_or_supply_hashes(self) -> None:
        """Public payloads cannot bypass capability or password handling."""

        for field, value in (
            ("is_admin", True),
            ("engineer_profile", {}),
            ("password_hash", "x"),
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                UserCreate(**self.user_data(**{field: value}))

    def test_password_length_bounds(self) -> None:
        """Reject passwords outside the documented 12–128 character range."""

        for length in (0, 11, 129):
            with self.subTest(length=length), self.assertRaises(ValidationError):
                UserCreate(**self.user_data(password="p" * length))
        for length in (12, 128):
            self.assertEqual(
                len(
                    UserCreate(
                        **self.user_data(password="p" * length)
                    ).password.get_secret_value()
                ),
                length,
            )
        with self.assertRaises(ValidationError):
            UserCreate(**self.user_data(password=" " * 16))

    def test_text_is_trimmed_and_blank_values_are_rejected(self) -> None:
        """Whitespace is not valid content or a valid facility name."""

        self.assertEqual(NoteCreate(body="  Details  ").body, "Details")
        self.assertEqual(BuildingCreate(name=" Headquarters ").name, "Headquarters")
        for schema, data in (
            (NoteCreate, {"body": " \n\t "}),
            (BuildingCreate, {"name": " "}),
            (IncidentCreate, self.incident_data(title=" ")),
            (IncidentCreate, self.incident_data(description=" ")),
        ):
            with (
                self.subTest(schema=schema.__name__),
                self.assertRaises(ValidationError),
            ):
                schema(**data)

    def test_text_length_limits(self) -> None:
        """Bound user-controlled payloads before they reach the database."""

        for schema, data in (
            (BuildingCreate, {"name": "x" * 101}),
            (FloorCreate, {"building_id": 1, "label": "x" * 51}),
            (IncidentCreate, self.incident_data(title="x" * 201)),
            (IncidentCreate, self.incident_data(description="x" * 10001)),
            (NoteCreate, {"body": "x" * 10001}),
            (IncidentPriorityUpdate, {"escalation_reason": "x" * 2001}),
        ):
            with (
                self.subTest(schema=schema.__name__),
                self.assertRaises(ValidationError),
            ):
                schema(**data)

    def test_incident_defaults_and_optional_location(self) -> None:
        """A building-only report starts with low priority and no escalation."""

        incident = IncidentCreate(**self.incident_data())
        self.assertEqual(incident.priority, IncidentPriority.LOW)
        self.assertIsNone(incident.floor_id)
        self.assertIsNone(incident.seat_id)
        self.assertIsNone(incident.escalation_reason)

    def test_seat_requires_floor(self) -> None:
        """Reject incomplete full location input and contradictory patches."""

        with self.assertRaises(ValidationError):
            IncidentCreate(**self.incident_data(seat_id=1))
        with self.assertRaises(ValidationError):
            IncidentAdminUpdate(floor_id=None, seat_id=1)
        self.assertEqual(
            IncidentCreate(**self.incident_data(floor_id=1, seat_id=1)).seat_id, 1
        )
        # A seat-only patch may refer to an existing floor; services merge/check it.
        self.assertEqual(IncidentAdminUpdate(seat_id=1).seat_id, 1)

    def test_ids_are_positive_integers_not_boolean_or_string(self) -> None:
        """Prevent coercion from accepting malformed foreign-key values."""

        for value in (True, False, 0, -1, "1", 1.5, 2_147_483_648):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                IncidentCreate(**self.incident_data(building_id=value))

    def test_incident_creation_rejects_privileged_and_server_fields(self) -> None:
        """Clients cannot choose ownership, workflow, or generated timestamps."""

        for field, value in (
            ("reporter_id", 2),
            ("assignee_id", 2),
            ("status", "Resolved"),
            ("created_at", "2026-01-01T00:00:00Z"),
            ("blocked_reason", "Waiting"),
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                IncidentCreate(**self.incident_data(**{field: value}))

    def test_fixed_category_and_priority_values(self) -> None:
        """Unrecognized public values cannot enter the model."""

        for changes in ({"category": "Software"}, {"priority": "Urgent"}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                IncidentCreate(**self.incident_data(**changes))

    def test_partial_updates_distinguish_omitted_from_explicit_null(self) -> None:
        """Escalation can be cleared without implicitly clearing priority."""

        patch = IncidentPriorityUpdate(escalation_reason=None)
        self.assertEqual(
            patch.model_dump(exclude_unset=True), {"escalation_reason": None}
        )
        self.assertEqual(
            IncidentAdminUpdate(floor_id=None, seat_id=None).model_dump(
                exclude_unset=True
            ),
            {"floor_id": None, "seat_id": None},
        )
        for schema, data in (
            (IncidentPriorityUpdate, {}),
            (IncidentPriorityUpdate, {"priority": None}),
            (IncidentPriorityUpdate, {"escalation_reason": " "}),
            (IncidentAdminUpdate, {"title": None}),
            (NoteUpdate, {"body": None}),
        ):
            with (
                self.subTest(schema=schema.__name__, data=data),
                self.assertRaises(ValidationError),
            ):
                schema(**data)

    def test_role_specific_payloads_reject_other_operations(self) -> None:
        """Priority, detail corrections, and assignment use distinct inputs."""

        for schema, data in (
            (IncidentPriorityUpdate, {"title": "Changed"}),
            (IncidentAdminUpdate, {"assignee_id": 1}),
            (IncidentAdminUpdate, {"status": "Closed"}),
            (IncidentAssignment, {}),
            (NoteCreate, {"body": "Note", "author_id": 2}),
            (NoteCreate, {"body": "Note", "incident_id": 2}),
        ):
            with (
                self.subTest(schema=schema.__name__),
                self.assertRaises(ValidationError),
            ):
                schema(**data)
        self.assertIsNone(IncidentAssignment(assignee_id=None).assignee_id)

    def test_engineer_availability_defaults_true_and_is_strict(self) -> None:
        """Use the agreed manual flag and reject ambiguous boolean coercion."""

        self.assertTrue(EngineerProfileCreate(user_id=1).is_available)
        with self.assertRaises(ValidationError):
            EngineerProfileCreate(user_id=1, is_available="false")

    def test_blocked_reason_and_role_neutral_status_validation(self) -> None:
        """Validate blocked context; authorization decides whether reopening is allowed."""

        for data in (
            {"status": "Blocked"},
            {"status": "Blocked", "blocked_reason": " "},
            {"status": "Resolved", "blocked_reason": "Waiting"},
        ):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                IncidentStatusUpdate(**data)
        self.assertEqual(
            IncidentStatusUpdate(
                status="Blocked", blocked_reason=" Waiting for parts "
            ).blocked_reason,
            "Waiting for parts",
        )
        self.assertIsNone(IncidentStatusUpdate(status="In Progress").blocked_reason)
        self.assertEqual(
            IncidentStatusUpdate(status="Open").status, IncidentStatus.OPEN
        )

    def test_read_timestamps_are_aware_and_normalized_to_utc(self) -> None:
        """Reject ambiguous naive timestamps and serialize a UTC instant."""

        data = self.incident_data(
            id=1,
            ticket_count=1,
            status="Open",
            priority="Medium",
            created_at=datetime(2026, 1, 1, 10, tzinfo=timezone(timedelta(hours=2))),
        )
        incident = IncidentRead(**data)
        self.assertEqual(
            incident.created_at, datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
        )
        self.assertIn('"created_at":"2026-01-01T08:00:00Z"', incident.model_dump_json())
        with self.assertRaises(ValidationError):
            IncidentRead(**{**data, "created_at": datetime(2026, 1, 1)})

    def test_all_public_schemas_generate_json_schema(self) -> None:
        """Every exported payload can participate in FastAPI OpenAPI generation."""

        for name in schemas.__all__:
            with self.subTest(name=name):
                self.assertIsInstance(getattr(schemas, name).model_json_schema(), dict)


if __name__ == "__main__":
    unittest.main()

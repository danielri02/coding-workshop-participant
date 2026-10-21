"""PostgreSQL integration checks in a temporary, isolated database schema."""

import os
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import create_engine, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.app.models import (
    Base,
    Building,
    EngineerProfile,
    Floor,
    Incident,
    IncidentCategory,
    IncidentPriority,
    IncidentStatus,
    Note,
    Seat,
    User,
)
from backend.app.schemas import IncidentRead, NoteRead, UserRead


class ModelTests(unittest.TestCase):
    """Exercise actual PostgreSQL foreign keys, defaults, and delete behavior."""

    @classmethod
    def setUpClass(cls) -> None:
        """Create only an isolated schema; never touch existing application tables."""

        database_url = os.environ.get("TEST_DATABASE_URL")
        if not database_url:
            raise unittest.SkipTest(
                "Set TEST_DATABASE_URL to run PostgreSQL integration tests"
            )
        cls.root_engine = create_engine(database_url)
        if cls.root_engine.dialect.name != "postgresql":
            cls.root_engine.dispose()
            raise ValueError("Model integration tests require PostgreSQL")
        cls.schema_name = f"test_incident_models_{uuid4().hex}"
        cls.addClassCleanup(cls.root_engine.dispose)
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema_name))
        cls.addClassCleanup(cls.cleanup_schema)
        cls.engine = cls.root_engine.execution_options(
            schema_translate_map={None: cls.schema_name}
        )
        Base.metadata.create_all(cls.engine)

    @classmethod
    def cleanup_schema(cls) -> None:
        """Remove only the schema generated for this test run."""

        with cls.root_engine.begin() as connection:
            connection.execute(
                DropSchema(cls.schema_name, cascade=True, if_exists=True)
            )

    def setUp(self) -> None:
        """Keep each test's changes inside a rollback-only transaction."""

        self.connection = self.engine.connect()
        self.transaction = self.connection.begin()
        self.session = Session(bind=self.connection)
        self.addCleanup(self.cleanup_transaction)
        self.reporter = User(
            name="Reporter", email="reporter@acme.inc", password_hash="test" * 8
        )
        self.engineer_user = User(
            name="Engineer", email="engineer@acme.inc", password_hash="test" * 8
        )
        self.building = Building(name="Headquarters")
        self.other_building = Building(name="Branch")
        self.session.add_all(
            [self.reporter, self.engineer_user, self.building, self.other_building]
        )
        self.session.flush()
        self.engineer = EngineerProfile(user_id=self.engineer_user.id)
        self.floor = Floor(building_id=self.building.id, label="1")
        self.other_floor = Floor(building_id=self.other_building.id, label="1")
        self.session.add_all([self.engineer, self.floor, self.other_floor])
        self.session.flush()
        self.seat = Seat(floor_id=self.floor.id, label="A1")
        self.other_seat = Seat(floor_id=self.other_floor.id, label="A1")
        self.session.add_all([self.seat, self.other_seat])
        self.session.flush()

    def cleanup_transaction(self) -> None:
        """Release the session and discard all test data."""

        self.session.close()
        if self.transaction.is_active:
            self.transaction.rollback()
        self.connection.close()

    def make_incident(self, **changes: object) -> Incident:
        """Persist a valid incident with optional field overrides."""

        incident = Incident(
            **{
                "title": "Flickering light",
                "description": "The lobby light flickers.",
                "category": IncidentCategory.ELECTRICAL,
                "reporter_id": self.reporter.id,
                "building_id": self.building.id,
                **changes,
            }
        )
        self.session.add(incident)
        self.session.flush()
        return incident

    def assert_rejected(self, instance: Base) -> None:
        """Assert a database rejection without poisoning the outer transaction."""

        with self.assertRaises(IntegrityError), self.session.begin_nested():
            self.session.add(instance)
            self.session.flush()

    def test_defaults_and_orm_serialization(self) -> None:
        """Defaults persist correctly and responses do not expose hashes."""

        incident = self.make_incident()
        note = Note(
            incident_id=incident.id,
            author_id=self.reporter.id,
            body="Reported to facilities.",
        )
        self.session.add(note)
        self.session.flush()
        self.assertFalse(self.reporter.is_admin)
        self.assertTrue(self.engineer.is_available)
        self.assertEqual(incident.status, IncidentStatus.OPEN)
        self.assertEqual(incident.priority, IncidentPriority.MEDIUM)
        self.assertIsNone(incident.assignee_id)
        self.assertEqual(
            IncidentRead.model_validate(incident).created_at.utcoffset(), timedelta(0)
        )
        self.assertEqual(
            NoteRead.model_validate(note).created_at.utcoffset(), timedelta(0)
        )
        self.assertNotIn(
            "password_hash", UserRead.model_validate(self.reporter).model_dump()
        )

    def test_admin_and_engineer_capabilities_coexist(self) -> None:
        """Promotion to Admin does not remove the engineer profile."""

        self.engineer_user.is_admin = True
        self.session.flush()
        result = UserRead.model_validate(self.engineer_user)
        self.assertTrue(result.is_admin)
        self.assertEqual(result.engineer_profile.user_id, self.engineer_user.id)

    def test_normalized_email_is_unique(self) -> None:
        """Duplicates and noncanonical email storage are rejected."""

        for email in (
            "reporter@acme.inc",
            "REPORTER@ACME.INC",
            " reporter@acme.inc ",
            "a@other.inc",
        ):
            with self.subTest(email=email):
                self.assert_rejected(
                    User(name="Other", email=email, password_hash="test" * 8)
                )

    def test_profile_requires_an_existing_user(self) -> None:
        """An engineer capability cannot exist independently of an employee."""

        self.assert_rejected(EngineerProfile(user_id=999999))

    def test_floor_and_seat_labels_are_unique_within_parent(self) -> None:
        """Equal labels in different parents are valid, duplicates within one fail."""

        self.assert_rejected(Floor(building_id=self.building.id, label="1"))
        self.assert_rejected(Seat(floor_id=self.floor.id, label="A1"))
        # Both fixtures already use matching labels in different parents.
        self.assertNotEqual(self.floor.id, self.other_floor.id)
        self.assertNotEqual(self.seat.id, self.other_seat.id)

    def test_building_only_floor_and_seat_locations_are_valid(self) -> None:
        """All three supported location granularities persist."""

        self.make_incident()
        self.make_incident(floor_id=self.floor.id)
        incident = self.make_incident(floor_id=self.floor.id, seat_id=self.seat.id)
        self.session.expire_all()
        self.assertEqual(incident.floor.id, self.floor.id)
        self.assertEqual(incident.seat.id, self.seat.id)

    def test_cross_building_floor_and_cross_floor_seat_are_rejected(self) -> None:
        """Composite foreign keys reject plausible but inconsistent location IDs."""

        for location in (
            {"floor_id": self.other_floor.id},
            {"floor_id": self.floor.id, "seat_id": self.other_seat.id},
            {"seat_id": self.seat.id},
            {"floor_id": 999999},
            {"building_id": 999999},
        ):
            with (
                self.subTest(location=location),
                self.assertRaises(IntegrityError),
                self.session.begin_nested(),
            ):
                self.make_incident(**location)

    def test_assignee_must_have_an_engineer_profile(self) -> None:
        """Employee IDs alone cannot be used as engineer assignments."""

        incident = self.make_incident(assignee_id=self.engineer.user_id)
        self.assertEqual(incident.assignee.user.id, self.engineer_user.id)
        with self.assertRaises(IntegrityError), self.session.begin_nested():
            self.make_incident(assignee_id=self.reporter.id)

    def test_blocked_reason_consistency_is_enforced_in_database(self) -> None:
        """Direct writes cannot bypass Blocked-state context requirements."""

        self.make_incident(
            status=IncidentStatus.BLOCKED, blocked_reason="Waiting for parts"
        )
        for changes in (
            {"status": IncidentStatus.BLOCKED},
            {"status": IncidentStatus.BLOCKED, "blocked_reason": " "},
            {"blocked_reason": "Stale reason"},
            {"escalation_reason": " "},
        ):
            with (
                self.subTest(changes=changes),
                self.assertRaises(IntegrityError),
                self.session.begin_nested(),
            ):
                self.make_incident(**changes)

    def test_enum_constraints_apply_to_direct_writes(self) -> None:
        """SQL clients cannot persist an unknown status, priority, or category."""

        incident = self.make_incident()
        for field in ("status", "priority", "category"):
            with (
                self.subTest(field=field),
                self.assertRaises(IntegrityError),
                self.session.begin_nested(),
            ):
                self.session.execute(
                    update(Incident)
                    .where(Incident.id == incident.id)
                    .values(**{field: "Bad"})
                )

    def test_referenced_engineer_and_locations_cannot_be_deleted(self) -> None:
        """Loaded ORM relationships must not silently null or cascade references."""

        self.make_incident(
            floor_id=self.floor.id,
            seat_id=self.seat.id,
            assignee_id=self.engineer.user_id,
        )
        # Load collections to exercise deletion behavior with ORM state present.
        list(self.engineer.assignments)
        list(self.building.floors)
        list(self.floor.seats)
        for instance in (
            self.engineer,
            self.seat,
            self.floor,
            self.building,
            self.reporter,
        ):
            with (
                self.subTest(instance=type(instance).__name__),
                self.assertRaises(IntegrityError),
                self.session.begin_nested(),
            ):
                self.session.delete(instance)
                self.session.flush()

    def test_relocating_a_referenced_floor_is_rejected(self) -> None:
        """Changing ancestry cannot silently change an incident's location."""

        self.make_incident(floor_id=self.floor.id)
        with self.assertRaises(IntegrityError), self.session.begin_nested():
            self.session.execute(
                update(Floor)
                .where(Floor.id == self.floor.id)
                .values(building_id=self.other_building.id)
            )

    def test_incident_deletion_cascades_notes_only(self) -> None:
        """Incident cleanup removes loaded or unloaded notes, preserving users."""

        for load_notes in (False, True):
            incident = self.make_incident()
            note = Note(
                incident_id=incident.id, author_id=self.reporter.id, body="Update"
            )
            self.session.add(note)
            self.session.flush()
            if load_notes:
                list(incident.notes)
            self.session.delete(incident)
            self.session.flush()
            count = self.session.scalar(
                select(func.count())
                .select_from(Note)
                .where(Note.incident_id == incident.id)
            )
            self.assertEqual(count, 0)
            self.assertIsNotNone(self.session.get(User, self.reporter.id))

    def test_notes_require_existing_incident_and_author(self) -> None:
        """Conversation entries cannot be orphaned or anonymously attributed."""

        incident = self.make_incident()
        self.assert_rejected(
            Note(incident_id=incident.id, author_id=999999, body="Update")
        )
        self.assert_rejected(
            Note(incident_id=999999, author_id=self.reporter.id, body="Update")
        )

    def test_blank_persisted_content_is_rejected(self) -> None:
        """Database checks protect required content even outside Pydantic."""

        incident = self.make_incident()
        self.assert_rejected(
            Note(incident_id=incident.id, author_id=self.reporter.id, body=" ")
        )
        self.assert_rejected(Building(name=" "))
        for field in ("title", "description"):
            with (
                self.subTest(field=field),
                self.assertRaises(IntegrityError),
                self.session.begin_nested(),
            ):
                self.make_incident(**{field: " "})

    def test_milestone_timestamps_cannot_precede_creation(self) -> None:
        """Reporting durations cannot become negative through persisted data."""

        created = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for field in ("assigned_at", "acknowledged_at", "resolved_at"):
            with (
                self.subTest(field=field),
                self.assertRaises(IntegrityError),
                self.session.begin_nested(),
            ):
                self.make_incident(
                    created_at=created, **{field: created - timedelta(seconds=1)}
                )
        with self.assertRaises(IntegrityError), self.session.begin_nested():
            self.make_incident(
                created_at=created,
                acknowledged_at=created + timedelta(hours=2),
                resolved_at=created + timedelta(hours=1),
            )


if __name__ == "__main__":
    unittest.main()

"""Reporting calculations and row-level access verified with real PostgreSQL."""

import os
import secrets
import unittest
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import create_engine, delete, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.app.database.session import get_session
from backend.app.main import app
from backend.app.models import (
    Building,
    EngineerProfile,
    Floor,
    Incident,
    Note,
    Seat,
    User,
)
from backend.app.security.config import SecuritySettings
from backend.app.security.dependencies import auth_settings
from backend.app.security.jwt import create_access_token
from backend.scripts.create_tables import initialize_database


class ReportTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        raw = os.environ.get("TEST_DATABASE_URL")
        if not raw:
            raise unittest.SkipTest("Set TEST_DATABASE_URL to run reporting tests")
        url = make_url(raw)
        cls.root_engine = create_engine(url)
        cls.schema = f"test_reports_{uuid4().hex}"
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema))
        cls.test_url = url.update_query_dict({"options": f"-csearch_path={cls.schema}"})
        cls.addClassCleanup(cls.cleanup_schema)

    @classmethod
    def cleanup_schema(cls) -> None:
        with cls.root_engine.begin() as connection:
            connection.execute(DropSchema(cls.schema, cascade=True, if_exists=True))
        cls.root_engine.dispose()

    async def asyncSetUp(self) -> None:
        self.engine = create_async_engine(self.test_url)
        self.addAsyncCleanup(self.engine.dispose)
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        await initialize_database(self.engine, reset=True)
        settings = SecuritySettings(jwt_secret_key=SecretStr(secrets.token_urlsafe(40)))

        async def session_override() -> AsyncIterator[AsyncSession]:
            async with self.factory() as session:
                yield session

        app.dependency_overrides[get_session] = session_override
        app.dependency_overrides[auth_settings] = lambda: settings
        self.addCleanup(app.dependency_overrides.pop, get_session)
        self.addCleanup(app.dependency_overrides.pop, auth_settings)
        self.client = AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.users = {}
        async with self.factory.begin() as session:
            for role in ("admin", "employee", "other", "engineer", "idle"):
                user = User(
                    name=role,
                    email=f"{role}@acme.inc",
                    password_hash="test" * 8,
                    is_admin=role == "admin",
                )
                session.add(user)
                await session.flush()
                self.users[role] = user.id
                if role in {"engineer", "idle"}:
                    session.add(
                        EngineerProfile(user_id=user.id, is_available=role == "idle")
                    )
            building = Building(name="Main office")
            session.add(building)
            await session.flush()
            floor = Floor(building_id=building.id, label="1")
            session.add(floor)
            await session.flush()
            seat = Seat(floor_id=floor.id, label="A1")
            session.add(seat)
            await session.flush()
            created = datetime(2026, 1, 1, tzinfo=timezone.utc)
            self.incidents = []
            for index, state in enumerate(
                ("Open", "In Progress", "Blocked", "Resolved", "Closed")
            ):
                record = Incident(
                    title=f"Issue {index}" if index else "Literal 100% issue",
                    description="A facility issue",
                    category="HVAC" if index < 3 else "Network",
                    building_id=building.id,
                    floor_id=floor.id,
                    seat_id=seat.id,
                    reporter_id=self.users["employee" if index < 2 else "other"],
                    assignee_id=self.users["engineer"] if index in {1, 2, 3} else None,
                    priority="High" if index == 2 else "Medium",
                    status=state,
                    blocked_reason="Waiting for a part" if index == 2 else None,
                    escalation_reason="Work is affected" if index in {2, 4} else None,
                    created_at=created,
                    assigned_at=created + timedelta(minutes=10) if index > 0 else None,
                    acknowledged_at=created + timedelta(minutes=20)
                    if index > 0
                    else None,
                    resolved_at=created + timedelta(minutes=100)
                    if index >= 3
                    else None,
                )
                session.add(record)
                await session.flush()
                self.incidents.append(record.id)
            for author, minute in (("employee", 1), ("admin", 2), ("engineer", 3)):
                session.add(
                    Note(
                        incident_id=self.incidents[0],
                        author_id=self.users[author],
                        body="Shared update",
                        created_at=created + timedelta(minutes=minute),
                    )
                )
            session.add(
                Note(
                    incident_id=self.incidents[1],
                    author_id=self.users["employee"],
                    body="Still affected",
                    created_at=created + timedelta(minutes=4),
                )
            )
        self.headers = {
            role: {"Authorization": f"Bearer {create_access_token(user_id, settings)}"}
            for role, user_id in self.users.items()
        }

    async def report(self, endpoint: str, actor: str = "admin", **params):
        if endpoint in {"locations", "categories", "timings"}:
            params.setdefault("period", "all")
        response = await self.client.get(
            f"/reports/{endpoint}", headers=self.headers[actor], params=params
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def test_report_totals_respect_personal_assigned_and_visible_scopes(
        self,
    ) -> None:
        for actor, expected in (("admin", 5), ("employee", 2), ("engineer", 3)):
            data = await self.report("categories", actor)
            self.assertEqual(
                sum(row["incident_count"] for row in data["rows"]), expected
            )
            self.assertEqual(
                (await self.report("timings", actor))["row_count"], expected
            )
        self.assertEqual(
            (await self.report("timings", scope="personal"))["row_count"], 0
        )
        self.assertEqual(
            (await self.report("timings", "engineer", scope="assigned"))["row_count"], 3
        )
        self.assertEqual((await self.report("timings", search="100%"))["row_count"], 1)
        first = await self.report(
            "timings", page_size=1, sort_by="id", sort_direction="asc"
        )
        second = await self.report(
            "timings", page_size=1, page=1, sort_by="id", sort_direction="asc"
        )
        self.assertEqual(first["row_count"], 5)
        self.assertEqual(first["rows"][0]["id"], self.incidents[0])
        self.assertEqual(second["rows"][0]["id"], self.incidents[1])

    async def test_summary_counts_complete_personal_and_assigned_scopes(self) -> None:
        personal = await self.report("summary", "employee")
        self.assertEqual(
            personal,
            {
                "scope": "personal",
                "total_count": 2,
                "active_count": 2,
                "open_count": 1,
                "assigned_count": 0,
                "in_progress_count": 1,
                "blocked_count": 0,
                "resolved_count": 0,
                "closed_count": 0,
            },
        )
        assigned = await self.report("summary", "engineer", scope="assigned")
        self.assertEqual(
            assigned,
            {
                "scope": "assigned",
                "total_count": 3,
                "active_count": 2,
                "open_count": 0,
                "assigned_count": 0,
                "in_progress_count": 1,
                "blocked_count": 1,
                "resolved_count": 1,
                "closed_count": 0,
            },
        )
        self.assertEqual((await self.report("summary", "engineer"))["total_count"], 0)
        self.assertEqual(
            (await self.report("summary", "idle", scope="assigned"))["total_count"], 0
        )
        all_counts = await self.report("summary", scope="visible")
        self.assertEqual(all_counts["total_count"], 5)
        for field in (
            "open_count",
            "in_progress_count",
            "blocked_count",
            "resolved_count",
            "closed_count",
        ):
            self.assertEqual(all_counts[field], 1)
        # Caller-supplied IDs/search cannot replace identity or narrow these all-scope totals.
        self.assertEqual(
            await self.report(
                "summary",
                "employee",
                reporter_id=self.users["other"],
                search="nonexistent",
                page_size=1,
            ),
            personal,
        )

    async def test_summary_follows_assignment_resolution_and_reassignment(self) -> None:
        path = f"/incidents/{self.incidents[0]}"
        response = await self.client.patch(
            path + "/assignment",
            headers=self.headers["admin"],
            json={"assignee_id": self.users["engineer"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "Assigned")
        assigned = await self.report("summary", "engineer", scope="assigned")
        self.assertEqual((assigned["total_count"], assigned["assigned_count"]), (4, 1))
        workload = await self.report("workload")
        engineer = next(
            row for row in workload["rows"] if row["id"] == self.users["engineer"]
        )
        self.assertEqual((engineer["assigned_count"], engineer["active_count"]), (1, 3))
        accepted = await self.client.patch(
            path + "/status",
            headers=self.headers["engineer"],
            json={"status": "In Progress"},
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        response = await self.client.patch(
            path + "/status",
            headers=self.headers["engineer"],
            json={"status": "Resolved"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        own = await self.report("summary", "employee")
        self.assertEqual((own["active_count"], own["resolved_count"]), (1, 1))
        response = await self.client.patch(
            path + "/assignment",
            headers=self.headers["admin"],
            json={"assignee_id": self.users["idle"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            (await self.report("summary", "engineer", scope="assigned"))["total_count"],
            3,
        )
        self.assertEqual(
            (await self.report("summary", "idle", scope="assigned"))["assigned_count"],
            1,
        )

    async def test_location_counts_combine_categories_at_each_level(
        self,
    ) -> None:
        for level in ("building", "floor", "seat"):
            data = await self.report("locations", level=level)
            self.assertEqual([row["incident_count"] for row in data["rows"]], [5])
            self.assertEqual(len({row["id"] for row in data["rows"]}), 1)
            self.assertEqual(data["rows"][0]["active_count"], 3)
        own = await self.report("locations", "employee", level="seat")
        self.assertEqual([row["incident_count"] for row in own["rows"]], [2])

    async def test_category_totals_include_zero_buckets_without_note_fanout(
        self,
    ) -> None:
        data = await self.report("categories")
        self.assertEqual(sum(row["incident_count"] for row in data["rows"]), 5)
        self.assertEqual(data["rows"][0]["percentage"], 60)
        own = await self.report("categories", "employee")
        self.assertEqual(sum(row["incident_count"] for row in own["rows"]), 2)
        self.assertTrue(any(row["incident_count"] == 0 for row in own["rows"]))

    async def test_timing_averages_exclude_missing_milestones_and_ignore_paging(
        self,
    ) -> None:
        data = await self.report("timings", page_size=1, sort_by="resolved_minutes")
        metrics = {row["id"]: row for row in data["milestones"]}
        self.assertEqual(data["row_count"], 5)
        self.assertEqual(metrics["assigned"]["average_minutes"], 10)
        self.assertEqual(metrics["assigned"]["sample_count"], 4)
        self.assertEqual(metrics["acknowledged"]["average_minutes"], 20)
        self.assertEqual(metrics["resolved"]["sample_count"], 2)
        self.assertEqual(metrics["resolved"]["average_minutes"], 100)
        own = await self.report("timings", "employee")
        self.assertIsNone(own["milestones"][2]["average_minutes"])

    async def test_report_navigation_ids_match_the_visible_incident_relationships(self):
        incident = (
            await self.client.get(
                f"/incidents/{self.incidents[1]}", headers=self.headers["admin"]
            )
        ).json()
        row = (await self.report("locations", level="seat"))["rows"][0]
        for field in ("building_id", "floor_id", "seat_id"):
            self.assertEqual(row[field], incident[field])
        timing = await self.report("timings", "engineer", search="Issue 1")
        self.assertEqual(timing["rows"][0]["assignee_id"], self.users["engineer"])

    async def test_workload_includes_idle_and_unavailable_engineers(self) -> None:
        data = await self.report("workload")
        busy, idle = data["rows"]
        self.assertEqual(
            (
                busy["name"],
                busy["total_count"],
                busy["active_count"],
                busy["high_priority_count"],
            ),
            ("engineer", 3, 2, 1),
        )
        self.assertFalse(busy["is_available"])
        self.assertEqual((idle["name"], idle["active_count"]), ("idle", 0))
        self.assertTrue(idle["is_available"])
        self.assertEqual(data["unassigned_count"], 1)

    async def test_period_boundaries_use_reported_date_for_rows_and_aggregates(self):
        now = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)
        dates = [
            now - timedelta(days=7),
            now - timedelta(days=7, microseconds=1),
            now - timedelta(days=30),
            now.replace(year=2025),
            now.replace(year=2024),
        ]
        async with self.factory.begin() as session:
            for incident_id, created in zip(self.incidents, dates, strict=True):
                await session.execute(
                    update(Incident)
                    .where(Incident.id == incident_id)
                    .values(
                        created_at=created,
                        assigned_at=None,
                        acknowledged_at=None,
                        resolved_at=now,
                    )
                )
        with patch("backend.app.database.reports.datetime") as clock:
            clock.now.return_value = now
            for period, expected in (
                ("week", 1),
                ("month", 3),
                ("year", 4),
                ("all", 5),
            ):
                timing = await self.report("timings", period=period, page_size=1)
                self.assertEqual(timing["row_count"], expected)
                self.assertEqual(timing["milestones"][2]["sample_count"], expected)
                self.assertEqual(
                    sum(
                        row["incident_count"]
                        for row in (await self.report("categories", period=period))[
                            "rows"
                        ]
                    ),
                    expected,
                )
                self.assertEqual(
                    (await self.report("locations", period=period))["rows"][0][
                        "incident_count"
                    ],
                    expected,
                )
                self.assertEqual(timing["end_at"], "2026-10-21T12:00:00Z")

    async def test_report_dimension_filters_combine_and_preserve_access_scope(self):
        async with self.factory.begin() as session:
            original = await session.get(Incident, self.incidents[0])
            original_floor, original_seat = original.floor_id, original.seat_id
            building = Building(name="Separate location")
            session.add(building)
            await session.flush()
            session.add(
                Incident(
                    title="Separate HVAC issue",
                    description="Location filter fixture",
                    category="HVAC",
                    building_id=building.id,
                    reporter_id=self.users["other"],
                )
            )
            separate_id = building.id
        locations = await self.report("locations", category="HVAC")
        self.assertEqual([row["incident_count"] for row in locations["rows"]], [3, 1])
        repeated = await self.report("locations", category="HVAC", repeated_only=True)
        self.assertEqual([row["incident_count"] for row in repeated["rows"]], [3])
        categories = await self.report("categories", building_id=separate_id)
        self.assertEqual(sum(row["incident_count"] for row in categories["rows"]), 1)
        for field, location_id in (
            ("floor_id", original_floor),
            ("seat_id", original_seat),
        ):
            self.assertEqual(
                sum(
                    row["incident_count"]
                    for row in (
                        await self.report("categories", **{field: location_id})
                    )["rows"]
                ),
                5,
            )
        self.assertEqual(
            sum(
                row["incident_count"]
                for row in (
                    await self.report(
                        "categories", building_id=separate_id, floor_id=original_floor
                    )
                )["rows"]
            ),
            0,
        )
        self.assertEqual(
            sum(
                row["incident_count"]
                for row in (
                    await self.report("categories", "employee", building_id=separate_id)
                )["rows"]
            ),
            0,
        )
        timing = await self.report(
            "timings", category="HVAC", assignee_id=self.users["engineer"], page_size=1
        )
        self.assertEqual(timing["row_count"], 2)
        self.assertEqual(timing["milestones"][0]["sample_count"], 2)
        self.assertEqual(timing["milestones"][0]["average_minutes"], 10)
        self.assertEqual(
            (
                await self.report(
                    "timings",
                    "employee",
                    category="HVAC",
                    assignee_id=self.users["engineer"],
                )
            )["row_count"],
            1,
        )
        self.assertEqual(
            (await self.report("timings", assignee_id=self.users["idle"]))["row_count"],
            0,
        )

    async def test_authentication_privilege_and_query_validation(self) -> None:
        for endpoint in ("locations", "categories", "timings", "workload", "summary"):
            self.assertEqual(
                (await self.client.get(f"/reports/{endpoint}")).status_code, 401
            )
        for endpoint in (
            "workload",
            "categories?scope=assigned",
            "summary?scope=assigned",
        ):
            self.assertEqual(
                (
                    await self.client.get(
                        f"/reports/{endpoint}", headers=self.headers["employee"]
                    )
                ).status_code,
                403,
            )
        for endpoint in (
            "timings?page_size=101",
            "timings?sort_by=password_hash",
            "timings?page=-1",
            "locations?level=unknown",
            "categories?scope=all",
            "summary?scope=all",
            "timings?period=invalid",
            "timings?assignee_id=-1",
            "timings?category=invalid",
            "categories?building_id=0",
        ):
            self.assertEqual(
                (
                    await self.client.get(
                        f"/reports/{endpoint}", headers=self.headers["admin"]
                    )
                ).status_code,
                422,
            )

    async def test_empty_reports_return_zero_counts_and_null_averages(self) -> None:
        async with self.factory.begin() as session:
            await session.execute(delete(Note))
            await session.execute(delete(Incident))
        self.assertFalse((await self.report("locations"))["rows"])
        summary = await self.report("summary", scope="visible")
        self.assertTrue(
            all(
                value == 0
                for field, value in summary.items()
                if field.endswith("_count")
            )
        )
        self.assertTrue(
            all(
                row["percentage"] == 0
                for row in (await self.report("categories"))["rows"]
            )
        )
        self.assertTrue(
            all(
                row["average_minutes"] is None
                for row in (await self.report("timings"))["milestones"]
            )
        )

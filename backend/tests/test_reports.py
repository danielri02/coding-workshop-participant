"""Reporting calculations and row-level access verified with real PostgreSQL."""

import os
import secrets
import unittest
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import create_engine, delete
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

    async def test_recurrence_ranks_location_category_groups_at_each_level(
        self,
    ) -> None:
        for level in ("building", "floor", "seat"):
            data = await self.report("locations", level=level)
            self.assertEqual([row["incident_count"] for row in data["rows"]], [3, 2])
            self.assertEqual(len({row["id"] for row in data["rows"]}), 2)
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

    async def test_authentication_privilege_and_query_validation(self) -> None:
        for endpoint in ("locations", "categories", "timings", "workload"):
            self.assertEqual(
                (await self.client.get(f"/reports/{endpoint}")).status_code, 401
            )
        for endpoint in ("workload", "categories?scope=assigned"):
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

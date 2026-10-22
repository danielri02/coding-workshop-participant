"""HTTP-level CRUD integration tests against an isolated PostgreSQL schema."""

import os
import secrets
import unittest
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from argon2 import PasswordHasher
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.app.database.session import get_session
from backend.app.main import app
from backend.app.models import Building, EngineerProfile, Floor, Note, Seat, User
from backend.app.security.config import SecuritySettings
from backend.app.security.dependencies import auth_settings
from backend.app.security.jwt import create_access_token
from backend.scripts.create_tables import initialize_database


class RouteTests(unittest.IsolatedAsyncioTestCase):
    """Exercise real routing, validation, serialization, and database constraints."""

    @classmethod
    def setUpClass(cls) -> None:
        """Create one disposable schema without touching application tables."""

        raw_url = os.environ.get("TEST_DATABASE_URL")
        if not raw_url:
            raise unittest.SkipTest(
                "Set TEST_DATABASE_URL to run API integration tests"
            )
        url = make_url(raw_url).set(drivername="postgresql+psycopg")
        cls.root_engine = create_engine(url)
        cls.addClassCleanup(cls.root_engine.dispose)
        cls.schema_name = f"test_routes_{uuid4().hex}"
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema_name))
        cls.addClassCleanup(cls.cleanup_schema)
        options = url.query.get("options", "")
        cls.test_url = url.update_query_dict(
            {"options": f"{options} -csearch_path={cls.schema_name}".strip()}
        )

    @classmethod
    def cleanup_schema(cls) -> None:
        """Remove only this test run's generated schema."""

        with cls.root_engine.begin() as connection:
            connection.execute(
                DropSchema(cls.schema_name, cascade=True, if_exists=True)
            )

    async def asyncSetUp(self) -> None:
        """Reset isolated tables and inject request-scoped async test sessions."""

        self.engine = create_async_engine(self.test_url)
        self.addAsyncCleanup(self.engine.dispose)
        self.factory = async_sessionmaker(
            self.engine, expire_on_commit=False, autoflush=False
        )
        await initialize_database(self.engine, reset=True)

        async def override_session() -> AsyncIterator[AsyncSession]:
            async with self.factory() as session:
                yield session

        app.dependency_overrides[get_session] = override_session
        self.addCleanup(app.dependency_overrides.pop, get_session)
        self.settings = SecuritySettings(
            jwt_secret_key=SecretStr(secrets.token_urlsafe(48))
        )
        app.dependency_overrides[auth_settings] = lambda: self.settings
        self.addCleanup(app.dependency_overrides.pop, auth_settings)
        self.client = AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        )
        self.addAsyncCleanup(self.client.aclose)
        async with self.factory.begin() as session:
            reporter = User(
                name="Reporter",
                email="reporter@acme.inc",
                password_hash="test" * 8,
                is_admin=True,
            )
            engineer = User(
                name="Engineer", email="engineer@acme.inc", password_hash="test" * 8
            )
            building = Building(name="Headquarters")
            other_building = Building(name="Branch")
            session.add_all([reporter, engineer, building, other_building])
            await session.flush()
            session.add(EngineerProfile(user_id=engineer.id))
            floor = Floor(building_id=building.id, label="1")
            other_floor = Floor(building_id=other_building.id, label="1")
            session.add_all([floor, other_floor])
            await session.flush()
            seat = Seat(floor_id=floor.id, label="A1")
            other_seat = Seat(floor_id=other_floor.id, label="A1")
            session.add_all([seat, other_seat])
            await session.flush()
            self.reporter_id, self.engineer_id = reporter.id, engineer.id
            self.building_id, self.other_building_id = building.id, other_building.id
            self.floor_id, self.other_floor_id = floor.id, other_floor.id
            self.seat_id, self.other_seat_id = seat.id, other_seat.id
        self.client.headers["Authorization"] = (
            f"Bearer {create_access_token(self.reporter_id, self.settings)}"
        )

    def report_data(self, **changes: object) -> dict[str, object]:
        """Provide a complete valid report for individual HTTP boundary checks."""

        return {
            "title": "Broken light",
            "description": "The light is flickering.",
            "category": "Electrical",
            "building_id": self.building_id,
            "floor_id": self.floor_id,
            "seat_id": self.seat_id,
            **changes,
        }

    async def create_report(self, **changes: object) -> dict[str, object]:
        """Create a valid incident through the authenticated API."""

        response = await self.client.post(
            "/incidents",
            json=self.report_data(**changes),
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def confirmed_delete(self, path: str):
        """Explicitly confirm the current impact preview, as the admin UI does."""

        preview = await self.client.get(f"/deletions{path}")
        self.assertEqual(preview.status_code, 200, preview.text)
        return await self.client.delete(
            path, params={"confirmation": preview.json()["confirmation_token"]}
        )

    async def test_facility_cascades_delete_only_contained_records(self) -> None:
        """Each location level cascades descendants, preserving siblings and people."""

        untouched = await self.create_report(
            building_id=self.other_building_id,
            floor_id=self.other_floor_id,
            seat_id=self.other_seat_id,
        )
        for kind in ("buildings", "floors", "seats"):
            with self.subTest(resource=kind):
                building = (
                    await self.client.post("/buildings", json={"name": kind})
                ).json()["id"]
                floor = (
                    await self.client.post(
                        "/floors", json={"building_id": building, "label": "1"}
                    )
                ).json()["id"]
                seat = (
                    await self.client.post(
                        "/seats", json={"floor_id": floor, "label": "A"}
                    )
                ).json()["id"]
                report = await self.create_report(
                    building_id=building, floor_id=floor, seat_id=seat
                )
                note = (
                    await self.client.post(
                        f"/incidents/{report['id']}/notes",
                        json={"body": "Remove with location"},
                    )
                ).json()["id"]
                root = {"buildings": building, "floors": floor, "seats": seat}[kind]
                path = f"/{kind}/{root}"
                preview = (await self.client.get(f"/deletions{path}")).json()
                expected = {"incidents": 1, "notes": 1, "seats": 1}
                if kind != "seats":
                    expected["floors"] = 1
                if kind == "buildings":
                    expected["buildings"] = 1
                self.assertEqual(preview["counts"], expected)
                self.assertEqual((await self.client.delete(path)).status_code, 409)
                self.assertEqual(
                    (await self.client.get(f"/notes/{note}")).status_code, 200
                )
                deleted = await self.client.delete(
                    path, params={"confirmation": preview["confirmation_token"]}
                )
                self.assertEqual(deleted.status_code, 204, deleted.text)
                for removed in (
                    path,
                    f"/seats/{seat}",
                    f"/incidents/{report['id']}",
                    f"/notes/{note}",
                ):
                    self.assertEqual((await self.client.get(removed)).status_code, 404)
                if kind != "buildings":
                    self.assertEqual(
                        (await self.client.get(f"/buildings/{building}")).status_code,
                        200,
                    )
                if kind == "seats":
                    self.assertEqual(
                        (await self.client.get(f"/floors/{floor}")).status_code, 200
                    )
                self.assertEqual(
                    (
                        await self.client.get(f"/incidents/{untouched['id']}")
                    ).status_code,
                    200,
                )
                self.assertEqual(
                    (await self.client.get(f"/users/{self.reporter_id}")).status_code,
                    200,
                )

    async def test_cascade_rejects_changed_preview_without_partial_deletion(
        self,
    ) -> None:
        """New dependent records require a new explicit confirmation."""

        report = await self.create_report()
        path = f"/incidents/{report['id']}"
        preview = (await self.client.get(f"/deletions{path}")).json()
        self.assertEqual(preview["counts"], {"incidents": 1})
        note = (
            await self.client.post(
                f"{path}/notes", json={"body": "Added after preview"}
            )
        ).json()["id"]
        response = await self.client.delete(
            path, params={"confirmation": preview["confirmation_token"]}
        )
        self.assertEqual(response.status_code, 409)
        for retained in (path, f"/notes/{note}"):
            self.assertEqual((await self.client.get(retained)).status_code, 200)
        self.assertEqual((await self.confirmed_delete(path)).status_code, 204)

    async def test_engineer_deletion_unassigns_work_and_preserves_history(self) -> None:
        """Profile removal keeps incidents, notes and milestones across every status."""

        reports = []
        for status in (
            "Open",
            "Assigned",
            "In Progress",
            "Blocked",
            "Resolved",
            "Closed",
        ):
            report = await self.create_report()
            path = f"/incidents/{report['id']}"
            response = await self.client.patch(
                f"{path}/assignment", json={"assignee_id": self.engineer_id}
            )
            self.assertEqual(response.status_code, 200, response.text)
            response = await self.client.patch(
                f"{path}/status",
                json={
                    "status": status,
                    **(
                        {"blocked_reason": "Awaiting parts"}
                        if status == "Blocked"
                        else {}
                    ),
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            reports.append(response.json())
        note = (
            await self.client.post(
                f"/incidents/{reports[0]['id']}/notes",
                headers={
                    "Authorization": f"Bearer {create_access_token(self.engineer_id, self.settings)}"
                },
                json={"body": "Engineer note"},
            )
        ).json()["id"]
        path = f"/engineer-profiles/{self.engineer_id}"
        preview = (await self.client.get(f"/deletions{path}")).json()
        self.assertEqual(preview["counts"], {"engineers": 1})
        self.assertEqual(preview["unassigned_incidents"], 6)
        self.assertEqual((await self.confirmed_delete(path)).status_code, 204)
        for report in reports:
            saved = (await self.client.get(f"/incidents/{report['id']}")).json()
            self.assertIsNone(saved["assignee_id"])
            self.assertIsNone(saved["blocked_reason"])
            self.assertEqual(
                saved["status"],
                report["status"]
                if report["status"] in {"Resolved", "Closed"}
                else "Open",
            )
            for field in ("assigned_at", "acknowledged_at", "resolved_at"):
                self.assertEqual(saved[field], report[field])
        self.assertEqual((await self.client.get(f"/notes/{note}")).status_code, 200)
        account = (await self.client.get(f"/users/{self.engineer_id}")).json()
        self.assertIsNone(account["engineer_profile"])

    async def test_user_deletion_cascades_own_reports_notes_and_profile_only(
        self,
    ) -> None:
        """An account cascade removes its content while retaining others' assigned work."""

        own_response = await self.client.post(
            "/incidents",
            json=self.report_data(),
            headers={
                "Authorization": f"Bearer {create_access_token(self.engineer_id, self.settings)}"
            },
        )
        self.assertEqual(own_response.status_code, 201, own_response.text)
        own = own_response.json()
        other = await self.create_report()
        path = f"/incidents/{other['id']}"
        await self.client.patch(
            f"{path}/assignment", json={"assignee_id": self.engineer_id}
        )
        removed_notes = []
        for incident_id, author_id in (
            (own["id"], self.reporter_id),
            (own["id"], self.engineer_id),
            (other["id"], self.engineer_id),
        ):
            response = await self.client.post(
                f"/incidents/{incident_id}/notes",
                headers={
                    "Authorization": f"Bearer {create_access_token(author_id, self.settings)}"
                },
                json={"body": "Dependent note"},
            )
            self.assertEqual(response.status_code, 201, response.text)
            removed_notes.append(response.json()["id"])
        kept_note = (
            await self.client.post(f"{path}/notes", json={"body": "Keep me"})
        ).json()["id"]
        user_path = f"/users/{self.engineer_id}"
        preview = (await self.client.get(f"/deletions{user_path}")).json()
        self.assertEqual(
            preview["counts"], {"users": 1, "engineers": 1, "incidents": 1, "notes": 3}
        )
        self.assertEqual(preview["unassigned_incidents"], 1)
        self.assertEqual((await self.confirmed_delete(user_path)).status_code, 204)
        for removed in (
            user_path,
            f"/engineer-profiles/{self.engineer_id}",
            f"/incidents/{own['id']}",
            *(f"/notes/{note}" for note in removed_notes),
        ):
            self.assertEqual((await self.client.get(removed)).status_code, 404)
        saved = (await self.client.get(path)).json()
        self.assertIsNone(saved["assignee_id"])
        self.assertEqual(saved["status"], "Open")
        self.assertEqual(
            (await self.client.get(f"/notes/{kept_note}")).status_code, 200
        )

    async def test_deletion_preview_is_admin_only_and_validates_targets(self) -> None:
        """Confirmation tokens do not grant deletion rights to ordinary accounts."""

        path = f"/buildings/{self.building_id}"
        preview = (await self.client.get(f"/deletions{path}")).json()
        engineer_headers = {
            "Authorization": f"Bearer {create_access_token(self.engineer_id, self.settings)}"
        }
        self.assertEqual(
            (
                await self.client.get(f"/deletions{path}", headers=engineer_headers)
            ).status_code,
            403,
        )
        self.assertEqual(
            (
                await self.client.delete(
                    path,
                    headers=engineer_headers,
                    params={"confirmation": preview["confirmation_token"]},
                )
            ).status_code,
            403,
        )
        for path, status in (
            ("/deletions/invalid/1", 422),
            ("/deletions/buildings/0", 422),
            ("/deletions/buildings/2147483647", 404),
        ):
            self.assertEqual((await self.client.get(path)).status_code, status)

    async def test_unexpected_read_failure_is_sanitized_json_with_cors(self) -> None:
        """Database outages remain visible to browsers without exposing SQL data."""

        failure = OperationalError(
            "private SQL", {"input": "private value"}, Exception()
        )
        with (
            patch(
                "backend.app.database.crud.list_records",
                new=AsyncMock(side_effect=failure),
            ),
            self.assertLogs("backend.app.errors", level="ERROR") as logs,
        ):
            response = await self.client.get(
                "/buildings", headers={"Origin": "http://localhost:3000"}
            )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.headers["access-control-allow-origin"], "http://localhost:3000"
        )
        self.assertEqual(response.headers["cache-control"], "no-store")
        body = response.json()
        self.assertEqual(body["request_id"], response.headers["x-request-id"])
        self.assertIn(body["request_id"], logs.output[0])
        self.assertIn("OperationalError", logs.output[0])
        self.assertNotIn("private", response.text + " ".join(logs.output))
        self.assertEqual((await self.client.get("/buildings")).status_code, 200)

    async def test_unexpected_write_failure_rolls_back_and_can_recover(self) -> None:
        """A failed flushed write is absent, and the next request can commit."""

        original_commit = AsyncSession.commit

        async def failing_commit(session: AsyncSession) -> None:
            await session.flush()
            raise OperationalError("private SQL", {}, Exception())

        with (
            patch.object(AsyncSession, "commit", failing_commit),
            self.assertLogs("backend.app.errors", level="ERROR"),
        ):
            response = await self.client.post(
                "/buildings", json={"name": "Failed building"}
            )
        self.assertEqual(response.status_code, 500)
        self.assertIn("detail", response.json())
        self.assertIs(AsyncSession.commit, original_commit)
        rows = (await self.client.get("/buildings")).json()
        self.assertNotIn("Failed building", [row["name"] for row in rows])
        response = await self.client.post(
            "/buildings", json={"name": "Recovered building"}
        )
        self.assertEqual(response.status_code, 201, response.text)

    async def test_users_crud_hashes_passwords_and_loads_profiles(self) -> None:
        """Account responses omit secrets and async nested profile reads work."""

        password = secrets.token_urlsafe(18)
        response = await self.client.post(
            "/users",
            json={
                "name": " New employee ",
                "email": " NEW@ACME.INC ",
                "password": password,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        user = response.json()
        user_id = user["id"]
        self.assertEqual(user["email"], "new@acme.inc")
        self.assertFalse(user["is_admin"])
        self.assertIsNone(user["engineer_profile"])
        self.assertNotIn("password", user)
        self.assertNotIn("password_hash", user)
        async with self.factory() as session:
            stored = await session.get(User, user_id)
            self.assertTrue(PasswordHasher().verify(stored.password_hash, password))
        response = await self.client.patch(
            f"/users/{user_id}", json={"name": "Updated"}
        )
        self.assertEqual(response.json()["name"], "Updated")
        response = await self.client.patch(
            f"/users/{user_id}/admin", json={"is_admin": True}
        )
        self.assertTrue(response.json()["is_admin"])
        response = await self.client.post(
            "/engineer-profiles", json={"user_id": user_id}
        )
        self.assertEqual(response.status_code, 201, response.text)
        response = await self.client.get(f"/users/{user_id}")
        self.assertTrue(response.json()["is_admin"])
        self.assertEqual(response.json()["engineer_profile"]["user_id"], user_id)
        listed = (await self.client.get("/users")).json()
        self.assertIn(user_id, [row["id"] for row in listed])
        self.assertEqual(
            (await self.client.delete(f"/users/{user_id}")).status_code, 409
        )
        self.assertEqual(
            (await self.client.delete(f"/engineer-profiles/{user_id}")).status_code, 204
        )
        self.assertEqual(
            (await self.client.delete(f"/users/{user_id}")).status_code, 204
        )
        self.assertEqual((await self.client.get(f"/users/{user_id}")).status_code, 404)

    async def test_duplicate_email_returns_safe_conflict_and_rolls_back(self) -> None:
        """Unique failures do not expose passwords, SQL, or poison later requests."""

        password = secrets.token_urlsafe(18)
        response = await self.client.post(
            "/users",
            json={
                "name": "Duplicate",
                "email": " REPORTER@ACME.INC ",
                "password": password,
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(set(response.json()), {"detail"})
        self.assertNotIn(password, response.text)
        self.assertNotIn("INSERT", response.text)
        self.assertEqual(len((await self.client.get("/users")).json()), 2)

    async def test_facility_crud_filters_and_reference_restrictions(self) -> None:
        """Facilities support all operations and reject deletion while referenced."""

        response = await self.client.post("/buildings", json={"name": "New building"})
        self.assertEqual(response.status_code, 201, response.text)
        building = response.json()["id"]
        self.assertEqual(
            (
                await self.client.patch(
                    f"/buildings/{building}", json={"name": "Renamed"}
                )
            ).json()["name"],
            "Renamed",
        )
        self.assertEqual(
            (await self.client.get(f"/buildings/{building}")).status_code, 200
        )
        response = await self.client.post(
            "/floors", json={"building_id": building, "label": "Ground"}
        )
        self.assertEqual(response.status_code, 201, response.text)
        floor = response.json()["id"]
        self.assertEqual(
            (
                await self.client.post(
                    "/floors", json={"building_id": building, "label": "Ground"}
                )
            ).status_code,
            409,
        )
        self.assertEqual(
            (await self.client.delete(f"/buildings/{building}")).status_code, 409
        )
        self.assertEqual(
            (await self.client.get("/floors", params={"building_id": building})).json()[
                0
            ]["id"],
            floor,
        )
        self.assertEqual(
            (await self.client.patch(f"/floors/{floor}", json={"label": "G"})).json()[
                "label"
            ],
            "G",
        )
        self.assertEqual((await self.client.get(f"/floors/{floor}")).status_code, 200)
        response = await self.client.post(
            "/seats", json={"floor_id": floor, "label": "Desk"}
        )
        self.assertEqual(response.status_code, 201, response.text)
        seat = response.json()["id"]
        self.assertEqual(
            (
                await self.client.patch(f"/seats/{seat}", json={"label": "Desk 1"})
            ).json()["label"],
            "Desk 1",
        )
        self.assertEqual((await self.client.get(f"/seats/{seat}")).status_code, 200)
        self.assertEqual(
            (await self.client.get("/seats", params={"floor_id": floor})).json()[0][
                "id"
            ],
            seat,
        )
        self.assertEqual(
            (await self.client.delete(f"/floors/{floor}")).status_code, 409
        )
        for path in (f"/seats/{seat}", f"/floors/{floor}", f"/buildings/{building}"):
            response = await self.client.delete(path)
            self.assertEqual(response.status_code, 204, response.text)
            self.assertEqual(response.content, b"")

    async def test_engineer_profile_crud(self) -> None:
        """Profiles use user_id as their key and expose manual availability."""

        response = await self.client.post(
            "/engineer-profiles", json={"user_id": self.reporter_id}
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["is_available"])
        self.assertEqual(
            (
                await self.client.post(
                    "/engineer-profiles", json={"user_id": self.reporter_id}
                )
            ).status_code,
            409,
        )
        response = await self.client.patch(
            f"/engineer-profiles/{self.reporter_id}", json={"is_available": False}
        )
        self.assertFalse(response.json()["is_available"])
        self.assertEqual(
            (
                await self.client.get(f"/engineer-profiles/{self.reporter_id}")
            ).status_code,
            200,
        )
        self.assertEqual(len((await self.client.get("/engineer-profiles")).json()), 2)
        self.assertEqual(
            (
                await self.client.delete(f"/engineer-profiles/{self.reporter_id}")
            ).status_code,
            204,
        )
        self.assertIsNone(
            (await self.client.get(f"/users/{self.reporter_id}")).json()[
                "engineer_profile"
            ]
        )

    async def test_incident_crud_priority_and_filters(self) -> None:
        """Reports retain server defaults and separate mutable operation inputs."""

        report = await self.create_report()
        incident = report["id"]
        self.assertEqual(report["status"], "Open")
        self.assertEqual(report["priority"], "Low")
        self.assertEqual(report["reporter_id"], self.reporter_id)
        self.assertTrue(report["created_at"].endswith("Z"))
        self.assertIsNone(report["assigned_at"])
        self.assertEqual(
            (await self.client.get(f"/incidents/{incident}")).json(), report
        )
        response = await self.client.patch(
            f"/incidents/{incident}", json={"title": "Corrected title"}
        )
        self.assertEqual(response.json()["title"], "Corrected title")
        response = await self.client.patch(
            f"/incidents/{incident}/priority",
            json={"priority": "High", "escalation_reason": "Urgent repair"},
        )
        self.assertEqual(response.json()["escalation_reason"], "Urgent repair")
        response = await self.client.patch(
            f"/incidents/{incident}/priority", json={"escalation_reason": None}
        )
        self.assertIsNone(response.json()["escalation_reason"])
        self.assertEqual(response.json()["priority"], "High")
        response = await self.client.get(
            "/incidents",
            params={
                "reporter_id": self.reporter_id,
                "status": "Open",
                "priority": "High",
                "category": "Electrical",
                "building_id": self.building_id,
            },
        )
        self.assertEqual([row["id"] for row in response.json()], [incident])
        self.assertEqual(
            (await self.client.get("/incidents", params={"status": "Closed"})).json(),
            [],
        )
        self.assertEqual(
            (await self.client.delete(f"/seats/{self.seat_id}")).status_code, 409
        )
        self.assertEqual(
            (await self.client.delete(f"/incidents/{incident}")).status_code, 204
        )
        self.assertEqual(
            (await self.client.get(f"/incidents/{incident}")).status_code, 404
        )

    async def test_grid_paging_and_sorting_are_stable(self) -> None:
        """Return total count and stable page boundaries, including sorted ties."""

        first = await self.create_report(title="Repeated")
        second = await self.create_report(title="Repeated")
        third = await self.create_report(title="Earlier")
        query = {"page_size": 2, "sort_by": "title", "sort_direction": "desc"}
        response = await self.client.get("/incidents/grid", params=query)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(
            (data["row_count"], data["page"], data["page_size"]), (3, 0, 2)
        )
        self.assertEqual(
            [row["id"] for row in data["rows"]], [first["id"], second["id"]]
        )
        response = await self.client.get("/incidents/grid", params={**query, "page": 1})
        self.assertEqual([row["id"] for row in response.json()["rows"]], [third["id"]])
        response = await self.client.get("/incidents/grid", params={**query, "page": 9})
        self.assertEqual(response.json()["row_count"], 3)
        self.assertEqual(response.json()["rows"], [])
        response = await self.client.patch(
            f"/incidents/{second['id']}/assignment",
            json={"assignee_id": self.engineer_id},
        )
        self.assertEqual(response.json()["assignee_name"], "Engineer")
        response = await self.client.get(
            "/incidents/grid", params={"sort_by": "assignee_name"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["rows"][0]["id"], second["id"])

    async def test_search_and_escalation_filters_apply_before_paging(self) -> None:
        """Search titles/descriptions literally, combine filters and count matches."""

        match = await self.create_report(
            title="Printer 100%_ready", escalation_reason="Urgent"
        )
        await self.create_report(title="Printer 100xxready")
        description_match = await self.create_report(
            title="Equipment issue", description="A PRINTER is broken."
        )
        for endpoint in ("/incidents", "/incidents/grid"):
            response = await self.client.get(endpoint, params={"search": " printer "})
            self.assertEqual(response.status_code, 200, response.text)
            rows = (
                response.json()["rows"]
                if endpoint.endswith("grid")
                else response.json()
            )
            self.assertEqual(len(rows), 3)
            response = await self.client.get(endpoint, params={"search": "%_"})
            rows = (
                response.json()["rows"]
                if endpoint.endswith("grid")
                else response.json()
            )
            self.assertEqual([row["id"] for row in rows], [match["id"]])
        response = await self.client.get(
            "/incidents/grid",
            params={"search": "printer", "escalated": "true", "page_size": 1},
        )
        self.assertEqual(response.json()["row_count"], 1)
        self.assertEqual(response.json()["rows"][0]["id"], match["id"])
        response = await self.client.get(
            "/incidents/grid", params={"search": "broken", "escalated": "false"}
        )
        self.assertEqual(response.json()["row_count"], 1)
        self.assertEqual(response.json()["rows"][0]["id"], description_match["id"])
        response = await self.client.get("/incidents/grid", params={"search": "   "})
        self.assertEqual(response.json()["row_count"], 3)

    async def test_grid_parameters_reject_invalid_or_unapproved_values(self) -> None:
        """Bound page sizes and sorting fields and preserve validation HTTP 422."""

        for params in (
            {"page": -1},
            {"page_size": 0},
            {"page_size": 101},
            {"sort_by": "password_hash"},
            {"sort_by": "id; DROP TABLE users"},
            {"sort_direction": "sideways"},
            {"escalated": "perhaps"},
            {"search": "x" * 201},
            {"reporter_id": -1},
        ):
            with self.subTest(params=params):
                response = await self.client.get("/incidents/grid", params=params)
                self.assertEqual(response.status_code, 422, response.text)

    async def test_location_checks_include_persisted_partial_values(self) -> None:
        """Creation and merged patches reject inconsistent hierarchy references."""

        for changes, expected in (
            ({"floor_id": self.other_floor_id}, 422),
            ({"seat_id": self.other_seat_id}, 422),
            ({"floor_id": None}, 422),
            ({"building_id": 999999}, 404),
        ):
            response = await self.client.post(
                "/incidents",
                params={"reporter_id": self.reporter_id},
                json=self.report_data(**changes),
            )
            self.assertEqual(response.status_code, expected, response.text)
        report = await self.create_report()
        for changes in (
            {"seat_id": self.other_seat_id},
            {"building_id": self.other_building_id},
            {"floor_id": None},
        ):
            response = await self.client.patch(
                f"/incidents/{report['id']}", json=changes
            )
            self.assertEqual(response.status_code, 422, response.text)
        unchanged = (await self.client.get(f"/incidents/{report['id']}")).json()
        self.assertEqual(unchanged["seat_id"], self.seat_id)
        response = await self.client.patch(
            f"/incidents/{report['id']}",
            json={
                "building_id": self.other_building_id,
                "floor_id": None,
                "seat_id": None,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["building_id"], self.other_building_id)

    async def test_assignments_preserve_first_timestamp(self) -> None:
        """Reassignment/unassignment does not rewrite the first-assignment metric."""

        report = await self.create_report()
        path = f"/incidents/{report['id']}/assignment"
        self.assertEqual(
            (
                await self.client.patch(path, json={"assignee_id": self.reporter_id})
            ).status_code,
            404,
        )
        response = await self.client.patch(path, json={"assignee_id": self.engineer_id})
        self.assertEqual(response.status_code, 200, response.text)
        first_assigned = response.json()["assigned_at"]
        self.assertIsNotNone(first_assigned)
        self.assertEqual(response.json()["status"], "Assigned")
        self.assertIsNone(response.json()["acknowledged_at"])
        self.assertEqual(
            (
                await self.client.delete(f"/engineer-profiles/{self.engineer_id}")
            ).status_code,
            409,
        )
        await self.client.post("/engineer-profiles", json={"user_id": self.reporter_id})
        response = await self.client.patch(path, json={"assignee_id": self.reporter_id})
        self.assertEqual(response.json()["assigned_at"], first_assigned)
        self.assertEqual(response.json()["status"], "Assigned")
        response = await self.client.patch(path, json={"assignee_id": None})
        self.assertIsNone(response.json()["assignee_id"])
        self.assertEqual(response.json()["assigned_at"], first_assigned)

    async def test_workflow_milestones_and_blocked_reason(self) -> None:
        """Admins can skip/reopen stages without losing first-entry timestamps."""

        report = await self.create_report()
        path = f"/incidents/{report['id']}/status"
        direct = await self.client.patch(path, json={"status": "Resolved"})
        self.assertEqual(direct.status_code, 200, direct.text)
        first_resolved = direct.json()["resolved_at"]
        response = await self.client.patch(path, json={"status": "In Progress"})
        self.assertEqual(response.status_code, 200, response.text)
        first_acknowledged = response.json()["acknowledged_at"]
        self.assertIsNotNone(first_acknowledged)
        self.assertEqual(
            (await self.client.patch(path, json={"status": "Blocked"})).status_code, 422
        )
        response = await self.client.patch(
            path, json={"status": "Blocked", "blocked_reason": "Waiting for parts"}
        )
        self.assertEqual(response.json()["blocked_reason"], "Waiting for parts")
        response = await self.client.patch(path, json={"status": "In Progress"})
        self.assertIsNone(response.json()["blocked_reason"])
        self.assertEqual(response.json()["acknowledged_at"], first_acknowledged)
        response = await self.client.patch(path, json={"status": "Resolved"})
        resolved_at = response.json()["resolved_at"]
        self.assertIsNotNone(resolved_at)
        self.assertEqual(resolved_at, first_resolved)
        self.assertEqual(
            (
                await self.client.post(
                    f"/incidents/{report['id']}/notes",
                    params={"author_id": self.reporter_id},
                    json={"body": "Follow-up after resolution"},
                )
            ).status_code,
            201,
        )
        response = await self.client.patch(path, json={"status": "Closed"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["resolved_at"], resolved_at)
        self.assertEqual(
            (await self.client.patch(path, json={"status": "In Progress"})).status_code,
            200,
        )
        self.assertEqual(
            (await self.client.patch(path, json={"status": "Open"})).status_code, 200
        )

    async def test_assignment_awaits_acceptance_without_rewriting_same_assignment_or_history(
        self,
    ) -> None:
        report = await self.create_report()
        path = f"/incidents/{report['id']}"
        response = await self.client.patch(
            path + "/assignment", json={"assignee_id": self.engineer_id}
        )
        first = response.json()
        self.assertEqual(first["status"], "Assigned")
        self.assertIsNone(first["acknowledged_at"])
        accepted = await self.client.patch(
            path + "/status", json={"status": "In Progress"}
        )
        self.assertIsNotNone(accepted.json()["acknowledged_at"])
        first = accepted.json()
        await self.client.patch(
            path + "/status", json={"status": "Blocked", "blocked_reason": "Waiting"}
        )
        response = await self.client.patch(
            path + "/assignment", json={"assignee_id": self.engineer_id}
        )
        self.assertEqual(response.json()["status"], "Blocked")
        self.assertEqual(response.json()["blocked_reason"], "Waiting")
        await self.client.post("/engineer-profiles", json={"user_id": self.reporter_id})
        response = await self.client.patch(
            path + "/assignment", json={"assignee_id": self.reporter_id}
        )
        self.assertEqual(response.json()["status"], "Assigned")
        self.assertIsNone(response.json()["blocked_reason"])
        for milestone in ("assigned_at", "acknowledged_at"):
            self.assertEqual(response.json()[milestone], first[milestone])
        await self.client.patch(path + "/status", json={"status": "Closed"})
        response = await self.client.patch(
            path + "/assignment", json={"assignee_id": None}
        )
        self.assertEqual(response.json()["status"], "Closed")
        response = await self.client.patch(
            path + "/assignment", json={"assignee_id": self.engineer_id}
        )
        self.assertEqual(response.json()["status"], "Assigned")

    async def test_note_crud_and_incident_cascade(self) -> None:
        """Notes support all CRUD operations and disappear with their incident."""

        report = await self.create_report()
        path = f"/incidents/{report['id']}/notes"
        response = await self.client.post(
            path,
            params={"author_id": self.reporter_id},
            json={"body": " Initial note "},
        )
        self.assertEqual(response.status_code, 201, response.text)
        note = response.json()["id"]
        self.assertEqual(response.json()["author_id"], self.reporter_id)
        self.assertEqual(response.json()["body"], "Initial note")
        self.assertEqual((await self.client.get(path)).json()[0]["id"], note)
        self.assertEqual((await self.client.get(f"/notes/{note}")).status_code, 200)
        self.assertEqual(
            (
                await self.client.patch(f"/notes/{note}", json={"body": "Corrected"})
            ).json()["body"],
            "Corrected",
        )
        self.assertEqual((await self.client.delete(f"/notes/{note}")).status_code, 204)
        self.assertEqual((await self.client.get(path)).json(), [])
        for body in ("First", "Second"):
            self.assertEqual(
                (
                    await self.client.post(
                        path,
                        params={"author_id": self.reporter_id},
                        json={"body": body},
                    )
                ).status_code,
                201,
            )
        notes = (await self.client.get(path)).json()
        self.assertEqual(
            (await self.confirmed_delete(f"/incidents/{report['id']}")).status_code, 204
        )
        for note in notes:
            self.assertEqual(
                (await self.client.get(f"/notes/{note['id']}")).status_code, 404
            )
        self.assertEqual((await self.client.get(path)).status_code, 404)
        self.assertEqual(
            (await self.client.get(f"/users/{self.reporter_id}")).status_code, 200
        )

    async def test_notes_are_chronological_and_editable_after_resolution(self) -> None:
        """Conversation order uses timestamps, and corrections remain possible."""

        report = await self.create_report()
        now = datetime.now(timezone.utc)
        async with self.factory.begin() as session:
            session.add(
                Note(
                    incident_id=report["id"],
                    author_id=self.reporter_id,
                    body="Later",
                    created_at=now,
                )
            )
            await session.flush()
            session.add(
                Note(
                    incident_id=report["id"],
                    author_id=self.reporter_id,
                    body="Earlier",
                    created_at=now - timedelta(minutes=1),
                )
            )
        notes = (await self.client.get(f"/incidents/{report['id']}/notes")).json()
        self.assertEqual([row["body"] for row in notes], ["Earlier", "Later"])
        for target in ("In Progress", "Resolved"):
            await self.client.patch(
                f"/incidents/{report['id']}/status", json={"status": target}
            )
        response = await self.client.patch(
            f"/notes/{notes[0]['id']}", json={"body": "Admin correction"}
        )
        self.assertEqual(response.status_code, 200, response.text)

    async def test_validation_and_missing_references(self) -> None:
        """Return predictable 404/422 responses for invalid IDs and payloads."""

        for prefix in (
            "users",
            "engineer-profiles",
            "buildings",
            "floors",
            "seats",
            "incidents",
            "notes",
        ):
            self.assertEqual(
                (await self.client.get(f"/{prefix}/999999")).status_code, 404
            )
            self.assertEqual((await self.client.get(f"/{prefix}/-1")).status_code, 422)
            self.assertEqual(
                (await self.client.get(f"/{prefix}/2147483648")).status_code, 422
            )
        self.assertEqual(
            (
                await self.client.get(
                    "/incidents", params={"reporter_id": 2_147_483_648}
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/engineer-profiles", json={"user_id": 2_147_483_648}
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/floors", json={"building_id": 999999, "label": "1"}
                )
            ).status_code,
            404,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/seats", json={"floor_id": 999999, "label": "A"}
                )
            ).status_code,
            404,
        )
        self.assertEqual(
            (await self.client.post("/incidents", json=self.report_data())).status_code,
            201,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/incidents",
                    params={"reporter_id": 999999},
                    json=self.report_data(),
                )
            ).status_code,
            201,
        )
        report = await self.create_report()
        self.assertEqual(
            (
                await self.client.post(
                    f"/incidents/{report['id']}/notes",
                    params={"author_id": 999999},
                    json={"body": "Note"},
                )
            ).status_code,
            201,
        )
        self.assertEqual(
            (
                await self.client.patch(
                    f"/incidents/{report['id']}", json={"reporter_id": self.engineer_id}
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.patch(f"/buildings/{self.building_id}", json={})
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.get("/incidents", params={"status": "Unknown"})
            ).status_code,
            422,
        )

    async def test_lists_have_no_implicit_limit(self) -> None:
        """List responses include every result, rather than an undocumented page."""

        async with self.factory.begin() as session:
            session.add_all(
                [Building(name=f"Building {index}") for index in range(105)]
            )
        response = await self.client.get("/buildings")
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertIsInstance(rows, list)
        self.assertEqual(len(rows), 107)
        self.assertEqual([row["id"] for row in rows], sorted(row["id"] for row in rows))

    async def test_health_and_openapi(self) -> None:
        """Health remains available and all CRUD resources are documented."""

        self.assertEqual((await self.client.get("/health")).json(), {"status": "ok"})
        response = await self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200, response.text)
        paths = response.json()["paths"]
        for path in (
            "/users",
            "/engineer-profiles",
            "/buildings",
            "/floors",
            "/seats",
            "/incidents",
            "/incidents/{incident_id}/notes",
        ):
            self.assertTrue({"get", "post"}.issubset(paths[path]))


if __name__ == "__main__":
    unittest.main()

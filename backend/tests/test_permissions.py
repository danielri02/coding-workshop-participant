"""Real JWT and PostgreSQL tests for overlapping persona permissions."""

import os
import re
import secrets
import unittest
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from httpx import ASGITransport, AsyncClient, Response
from pydantic import SecretStr
from sqlalchemy import create_engine
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


class PermissionTests(unittest.IsolatedAsyncioTestCase):
    """Exercise permissions at HTTP boundaries without bypassing authentication."""

    @classmethod
    def setUpClass(cls) -> None:
        """Create a disposable PostgreSQL schema for the persona matrix."""

        raw_url = os.environ.get("TEST_DATABASE_URL")
        if not raw_url:
            raise unittest.SkipTest("Set TEST_DATABASE_URL to run permission tests")
        url = make_url(raw_url).set(drivername="postgresql+psycopg")
        cls.root_engine = create_engine(url)
        cls.addClassCleanup(cls.root_engine.dispose)
        cls.schema_name = f"test_permissions_{uuid4().hex}"
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema_name))
        cls.addClassCleanup(cls.cleanup_schema)
        options = url.query.get("options", "")
        cls.test_url = url.update_query_dict(
            {"options": f"{options} -csearch_path={cls.schema_name}".strip()}
        )

    @classmethod
    def cleanup_schema(cls) -> None:
        """Drop only this class's temporary schema."""

        with cls.root_engine.begin() as connection:
            connection.execute(
                DropSchema(cls.schema_name, cascade=True, if_exists=True)
            )

    async def asyncSetUp(self) -> None:
        """Prepare employees, engineers, admin and overlapping admin/engineer."""

        self.engine = create_async_engine(self.test_url)
        self.addAsyncCleanup(self.engine.dispose)
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        await initialize_database(self.engine, reset=True)
        self.settings = SecuritySettings(
            jwt_secret_key=SecretStr(secrets.token_urlsafe(48))
        )

        async def override_session() -> AsyncIterator[AsyncSession]:
            async with self.factory() as session:
                yield session

        app.dependency_overrides[get_session] = override_session
        app.dependency_overrides[auth_settings] = lambda: self.settings
        self.addCleanup(app.dependency_overrides.pop, get_session)
        self.addCleanup(app.dependency_overrides.pop, auth_settings)
        self.client = AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.ids = {}
        async with self.factory.begin() as session:
            for role in (
                "employee",
                "other",
                "engineer",
                "replacement",
                "admin",
                "combined",
            ):
                user = User(
                    name=role,
                    email=f"{role}@acme.inc",
                    password_hash="test" * 8,
                    is_admin=role in {"admin", "combined"},
                )
                session.add(user)
                await session.flush()
                self.ids[role] = user.id
                if role in {"engineer", "replacement", "combined"}:
                    session.add(EngineerProfile(user_id=user.id))
            building = Building(name="Headquarters")
            session.add(building)
            await session.flush()
            floor = Floor(building_id=building.id, label="1")
            session.add(floor)
            await session.flush()
            seat = Seat(floor_id=floor.id, label="A1")
            session.add(seat)
            await session.flush()
            self.building_id, self.floor_id, self.seat_id = (
                building.id,
                floor.id,
                seat.id,
            )
            self.reports = {}
            for key, reporter, assignee in (
                ("assigned", "employee", "engineer"),
                ("other", "other", None),
                ("engineer_owned", "engineer", "replacement"),
            ):
                report = Incident(
                    **self.report_data(),
                    reporter_id=self.ids[reporter],
                    assignee_id=self.ids[assignee] if assignee else None,
                )
                session.add(report)
                await session.flush()
                self.reports[key] = report.id
            note = Note(
                incident_id=self.reports["assigned"],
                author_id=self.ids["employee"],
                body="Shared conversation",
            )
            session.add(note)
            await session.flush()
            self.note_id = note.id
        self.actor_headers = {
            actor: {
                "Authorization": f"Bearer {create_access_token(user_id, self.settings)}"
            }
            for actor, user_id in self.ids.items()
        }

    def report_data(self) -> dict[str, object]:
        """Return a valid minimal incident request."""

        return {
            "title": "Broken light",
            "description": "Flickering light",
            "category": "Electrical",
            "building_id": self.building_id,
        }

    def headers(self, actor: str) -> dict[str, str]:
        """Issue a genuine signed access credential for an existing fixture account."""

        return self.actor_headers[actor].copy()

    async def request(
        self,
        actor: str,
        method: str,
        path: str,
        expected: int,
        payload: dict[str, object] | None = None,
    ) -> Response:
        """Send an authenticated request and check its permission outcome."""

        response = await self.client.request(
            method, path, headers=self.headers(actor), json=payload
        )
        self.assertEqual(
            response.status_code, expected, f"{actor} {method} {path}: {response.text}"
        )
        return response

    async def test_every_business_operation_requires_bearer_authentication(
        self,
    ) -> None:
        """Protect every registered business operation, including future additions."""

        for path, operations in app.openapi()["paths"].items():
            for method, operation in operations.items():
                if (
                    path.startswith("/auth/")
                    or path == "/health"
                    or (path == "/users" and method == "post")
                ):
                    continue
                self.assertTrue(operation.get("security"), f"{method} {path}")
                target = re.sub(r"\{[^}]+\}", "1", path)
                response = await self.client.request(method, target, json={})
                self.assertEqual(
                    response.status_code, 401, f"{method} {path}: {response.text}"
                )
                self.assertEqual(response.headers["www-authenticate"], "Bearer")
        for path in ("/health", "/docs", "/openapi.json"):
            self.assertEqual((await self.client.get(path)).status_code, 200)

    async def test_invalid_expired_wrong_signature_and_deleted_account_tokens(
        self,
    ) -> None:
        """Authentication rejects invalid JWTs and identities no longer in the DB."""

        wrong_settings = SecuritySettings(
            jwt_secret_key=SecretStr(secrets.token_urlsafe(48))
        )
        values = (
            secrets.token_urlsafe(32),
            create_access_token(
                self.ids["employee"],
                self.settings,
                now=datetime.now(timezone.utc) - timedelta(hours=1),
            ),
            create_access_token(self.ids["employee"], wrong_settings),
        )
        for value in values:
            response = await self.client.get(
                "/incidents", headers={"Authorization": f"Bearer {value}"}
            )
            self.assertEqual(response.status_code, 401, response.text)
        former_headers = self.headers("admin")
        async with self.factory.begin() as session:
            await session.delete(await session.get(User, self.ids["admin"]))
        self.assertEqual(
            (await self.client.get("/incidents", headers=former_headers)).status_code,
            401,
        )

    async def test_read_scopes_combine_and_filters_cannot_expand_them(self) -> None:
        """Apply the same persona grants to incident lists and direct IDs."""

        scopes = {
            "employee": {self.reports["assigned"]},
            "other": {self.reports["other"]},
            "engineer": {self.reports["assigned"], self.reports["engineer_owned"]},
            "replacement": {self.reports["engineer_owned"]},
            "admin": set(self.reports.values()),
            "combined": set(self.reports.values()),
        }
        for actor, expected in scopes.items():
            response = await self.request(actor, "GET", "/incidents", 200)
            self.assertEqual({row["id"] for row in response.json()}, expected)
            for incident_id in self.reports.values():
                await self.request(
                    actor,
                    "GET",
                    f"/incidents/{incident_id}",
                    200 if incident_id in expected else 403,
                )
        response = await self.request(
            "employee", "GET", f"/incidents?reporter_id={self.ids['other']}", 200
        )
        self.assertEqual(response.json(), [])
        response = await self.request(
            "engineer", "GET", f"/incidents?assignee_id={self.ids['replacement']}", 200
        )
        self.assertEqual(
            [row["id"] for row in response.json()], [self.reports["engineer_owned"]]
        )

    async def test_grid_rows_counts_and_search_share_incident_read_scope(self) -> None:
        """Counts and pages cannot reveal incidents outside a persona's grants."""

        counts = {
            "employee": 1,
            "other": 1,
            "engineer": 2,
            "replacement": 1,
            "admin": 3,
            "combined": 3,
        }
        for actor, count in counts.items():
            response = await self.request(
                actor, "GET", "/incidents/grid?page_size=1&search=light", 200
            )
            self.assertEqual(response.json()["row_count"], count)
            self.assertEqual(len(response.json()["rows"]), 1)
        async with self.factory.begin() as session:
            (
                await session.get(Incident, self.reports["other"])
            ).title = "Hidden printer"
        response = await self.request(
            "employee", "GET", "/incidents/grid?search=printer", 200
        )
        self.assertEqual(response.json()["row_count"], 0)
        self.assertEqual(response.json()["rows"], [])
        response = await self.request(
            "admin", "GET", "/incidents/grid?search=printer", 200
        )
        self.assertEqual(response.json()["row_count"], 1)

    async def test_visible_incidents_and_notes_include_names_without_people_lookup(
        self,
    ) -> None:
        """Employees see permitted workers/authors while the user directory stays private."""

        incident_path = f"/incidents/{self.reports['assigned']}"
        response = await self.request("employee", "GET", incident_path, 200)
        self.assertEqual(response.json()["assignee_name"], "engineer")
        await self.request("employee", "GET", f"/users/{self.ids['engineer']}", 403)
        response = await self.request(
            "engineer", "POST", incident_path + "/notes", 201, {"body": "Working on it"}
        )
        self.assertEqual(response.json()["author_name"], "engineer")
        response = await self.request("employee", "GET", incident_path + "/notes", 200)
        self.assertEqual(
            [note["author_name"] for note in response.json()], ["employee", "engineer"]
        )
        for note in response.json():
            self.assertNotIn("email", note)
            self.assertNotIn("password_hash", note)
        response = await self.request("employee", "GET", f"/notes/{self.note_id}", 200)
        self.assertEqual(response.json()["author_name"], "employee")
        await self.request(
            "employee",
            "PATCH",
            f"/users/{self.ids['employee']}",
            200,
            {"name": "Updated employee"},
        )
        response = await self.request("employee", "GET", f"/notes/{self.note_id}", 200)
        self.assertEqual(response.json()["author_name"], "Updated employee")
        await self.request("other", "GET", incident_path, 403)
        await self.request("other", "GET", f"/notes/{self.note_id}", 403)

    async def test_authenticated_identity_controls_reporter_and_note_author(
        self,
    ) -> None:
        """Legacy query arguments cannot impersonate another employee."""

        response = await self.request(
            "employee",
            "POST",
            f"/incidents?reporter_id={self.ids['other']}",
            201,
            self.report_data(),
        )
        self.assertEqual(response.json()["reporter_id"], self.ids["employee"])
        response = await self.request(
            "engineer",
            "POST",
            f"/incidents/{self.reports['assigned']}/notes?author_id={self.ids['other']}",
            201,
            {"body": "Engineer update"},
        )
        self.assertEqual(response.json()["author_id"], self.ids["engineer"])

    async def test_incident_corrections_assignment_and_deletion_require_admin(
        self,
    ) -> None:
        """Owning or being assigned a report does not grant general edit/delete."""

        for actor, incident_id in (
            ("employee", self.reports["assigned"]),
            ("engineer", self.reports["assigned"]),
            ("engineer", self.reports["engineer_owned"]),
        ):
            path = f"/incidents/{incident_id}"
            await self.request(actor, "PATCH", path, 403, {"title": "Correction"})
            await self.request(
                actor,
                "PATCH",
                path + "/assignment",
                403,
                {"assignee_id": self.ids["engineer"]},
            )
            await self.request(actor, "DELETE", path, 403)
        for actor in ("admin", "combined"):
            path = f"/incidents/{self.reports['assigned']}"
            await self.request(actor, "PATCH", path, 200, {"title": "Admin correction"})
            await self.request(
                actor,
                "PATCH",
                path + "/assignment",
                200,
                {"assignee_id": self.ids["engineer"]},
            )
            response = await self.request(
                actor, "POST", "/incidents", 201, self.report_data()
            )
            await self.request(
                actor, "DELETE", f"/incidents/{response.json()['id']}", 204
            )

    async def test_facility_and_engineer_management_is_admin_only(self) -> None:
        """Allow authenticated lookup reads while reserving management for admins."""

        resources = (
            ("buildings", self.building_id, {"name": "New"}, {"name": "Updated"}),
            (
                "floors",
                self.floor_id,
                {"building_id": self.building_id, "label": "2"},
                {"label": "Updated"},
            ),
            (
                "seats",
                self.seat_id,
                {"floor_id": self.floor_id, "label": "A2"},
                {"label": "Updated"},
            ),
            (
                "engineer-profiles",
                self.ids["engineer"],
                {"user_id": self.ids["other"]},
                {"is_available": False},
            ),
        )
        for actor in self.ids:
            for name, record_id, create, update in resources:
                await self.request(actor, "GET", f"/{name}", 200)
                await self.request(actor, "GET", f"/{name}/{record_id}", 200)
                if actor not in {"admin", "combined"}:
                    await self.request(actor, "POST", f"/{name}", 403, create)
                    await self.request(
                        actor, "PATCH", f"/{name}/{record_id}", 403, update
                    )
                    await self.request(actor, "DELETE", f"/{name}/{record_id}", 403)
        await self.request(
            "combined",
            "POST",
            "/engineer-profiles",
            201,
            {"user_id": self.ids["other"]},
        )
        await self.request(
            "combined",
            "PATCH",
            f"/engineer-profiles/{self.ids['other']}",
            200,
            {"is_available": False},
        )
        await self.request(
            "combined", "DELETE", f"/engineer-profiles/{self.ids['other']}", 204
        )

    async def test_account_management_cannot_self_grant_capabilities(self) -> None:
        """Permit own account edits but reserve directory, roles and deletion for admins."""

        for actor in ("employee", "engineer", "replacement"):
            own = self.ids[actor]
            other = self.ids["other"]
            await self.request(actor, "GET", "/users", 403)
            await self.request(actor, "GET", f"/users/{own}", 200)
            await self.request(actor, "GET", f"/users/{other}", 403)
            await self.request(
                actor, "PATCH", f"/users/{own}", 200, {"name": "My name"}
            )
            await self.request(
                actor, "PATCH", f"/users/{other}", 403, {"name": "Other name"}
            )
            await self.request(
                actor, "PATCH", f"/users/{own}/admin", 403, {"is_admin": True}
            )
            await self.request(actor, "DELETE", f"/users/{own}", 403)
        for actor in ("admin", "combined"):
            await self.request(actor, "GET", "/users", 200)
            await self.request(
                actor,
                "PATCH",
                f"/users/{self.ids['other']}",
                200,
                {"name": "Admin correction"},
            )

    async def test_notes_inherit_visibility_and_only_admins_correct_or_delete(
        self,
    ) -> None:
        """All incident viewers read/post shared notes; authors get no edit privilege."""

        incident_path = f"/incidents/{self.reports['assigned']}"
        for actor in self.ids:
            visible = actor in {"employee", "engineer", "admin", "combined"}
            await self.request(
                actor, "GET", incident_path + "/notes", 200 if visible else 403
            )
            await self.request(
                actor, "GET", f"/notes/{self.note_id}", 200 if visible else 403
            )
            response = await self.request(
                actor,
                "POST",
                incident_path + "/notes",
                201 if visible else 403,
                {"body": "Shared update"},
            )
            if visible and actor not in {"admin", "combined"}:
                for note_id in (self.note_id, response.json()["id"]):
                    await self.request(
                        actor, "PATCH", f"/notes/{note_id}", 403, {"body": "Correction"}
                    )
                    await self.request(actor, "DELETE", f"/notes/{note_id}", 403)
        for state in ("In Progress", "Resolved", "Closed"):
            await self.request(
                "engineer", "PATCH", incident_path + "/status", 200, {"status": state}
            )
        for actor in ("employee", "engineer", "admin", "combined"):
            await self.request(actor, "GET", incident_path + "/notes", 200)
            await self.request(
                actor, "POST", incident_path + "/notes", 409, {"body": "Too late"}
            )
        await self.request(
            "admin",
            "PATCH",
            f"/notes/{self.note_id}",
            200,
            {"body": "Admin correction after closure"},
        )
        await self.request("combined", "DELETE", f"/notes/{self.note_id}", 204)

    async def test_status_and_priority_use_distinct_capabilities_and_active_rules(
        self,
    ) -> None:
        """Engineers transition assignments; reporters prioritize only own active work."""

        path = f"/incidents/{self.reports['assigned']}"
        await self.request(
            "employee", "PATCH", path + "/status", 403, {"status": "In Progress"}
        )
        await self.request(
            "replacement", "PATCH", path + "/status", 403, {"status": "In Progress"}
        )
        await self.request(
            "engineer",
            "PATCH",
            f"/incidents/{self.reports['engineer_owned']}/status",
            403,
            {"status": "In Progress"},
        )
        await self.request(
            "engineer", "PATCH", path + "/priority", 403, {"priority": "High"}
        )
        await self.request(
            "other", "PATCH", path + "/priority", 403, {"priority": "High"}
        )
        await self.request(
            "employee",
            "PATCH",
            path + "/priority",
            200,
            {"priority": "High", "escalation_reason": "Urgent impact"},
        )
        await self.request(
            "engineer",
            "PATCH",
            f"/incidents/{self.reports['engineer_owned']}/priority",
            200,
            {"priority": "High"},
        )
        for payload in (
            {"status": "In Progress"},
            {"status": "Blocked", "blocked_reason": "Waiting"},
            {"status": "In Progress"},
            {"status": "Resolved"},
            {"status": "Closed"},
        ):
            await self.request("engineer", "PATCH", path + "/status", 200, payload)
        await self.request(
            "employee", "PATCH", path + "/priority", 403, {"priority": "Low"}
        )
        for actor in ("admin", "combined"):
            await self.request(
                actor,
                "PATCH",
                path + "/priority",
                200,
                {"priority": "Low", "escalation_reason": None},
            )

    async def test_reassignment_and_role_changes_take_effect_without_new_tokens(
        self,
    ) -> None:
        """Revoke assignment-based reads immediately while retaining other grants."""

        path = f"/incidents/{self.reports['assigned']}"
        await self.request(
            "admin",
            "PATCH",
            path + "/assignment",
            200,
            {"assignee_id": self.ids["replacement"]},
        )
        await self.request("engineer", "GET", path, 403)
        await self.request("engineer", "GET", f"/notes/{self.note_id}", 403)
        await self.request(
            "engineer", "PATCH", path + "/status", 403, {"status": "In Progress"}
        )
        await self.request("replacement", "GET", path, 200)
        await self.request("employee", "GET", path, 200)
        response = await self.request("engineer", "GET", "/incidents", 200)
        self.assertEqual(
            [row["id"] for row in response.json()], [self.reports["engineer_owned"]]
        )
        await self.request(
            "combined",
            "PATCH",
            f"/users/{self.ids['combined']}/admin",
            200,
            {"is_admin": False},
        )
        await self.request("combined", "GET", path, 403)
        await self.request("combined", "GET", "/users", 403)
        await self.request(
            "admin",
            "PATCH",
            f"/users/{self.ids['combined']}/admin",
            200,
            {"is_admin": True},
        )
        await self.request("combined", "GET", path, 200)

"""Key authorization and atomic reset/seed tests against an isolated schema."""

import asyncio
import os
import secrets
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.app.database.session import get_session
from backend.app.main import app
from backend.app.maintenance import reset
from backend.app.models import Base, Building, Incident, User
from backend.app.routes import dev
from backend.app.security.config import get_security_settings
from backend.app.security.jwt import create_access_token

PATH = "/dev/database/init"


class DatabaseInitAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_database_access_without_an_explicit_valid_key(self):
        key = secrets.token_urlsafe(48)
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            with patch.object(
                dev, "reset_database", new_callable=AsyncMock
            ) as operation:
                for configured, headers, status in (
                    ("", {}, 503),
                    ("short", {"X-Database-Reset-Key": "short"}, 503),
                    (key, {}, 403),
                    (key, {"X-Database-Reset-Key": "incorrect"}, 403),
                    (key, {"Authorization": "Bearer token"}, 403),
                ):
                    with (
                        self.subTest(status=status, headers=headers),
                        patch.dict(os.environ, {"DATABASE_RESET_KEY": configured}),
                    ):
                        response = await client.post(PATH, headers=headers)
                        self.assertEqual(response.status_code, status, response.text)
                        self.assertNotIn(key, response.text)
                        self.assertEqual(response.headers["cache-control"], "no-store")
                operation.assert_not_awaited()

    async def test_post_requires_header_and_rejects_target_or_operation_overrides(self):
        key = secrets.token_urlsafe(48)
        headers = {"X-Database-Reset-Key": key}
        with (
            patch.dict(os.environ, {"DATABASE_RESET_KEY": key}),
            patch.object(
                dev, "reset_database", new_callable=AsyncMock, return_value={"users": 8}
            ) as operation,
        ):
            async with AsyncClient(
                transport=ASGITransport(app), base_url="http://test"
            ) as client:
                self.assertEqual(
                    (await client.get(PATH, headers=headers)).status_code, 405
                )
                self.assertEqual(
                    (await client.post(PATH, params={"key": key})).status_code, 403
                )
                self.assertEqual(
                    (
                        await client.post(
                            PATH,
                            headers=headers,
                            json={"database_url": "ignored", "seed": False},
                        )
                    ).status_code,
                    422,
                )
                operation.assert_not_awaited()
                response = await client.post(PATH, headers=headers)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(
                    response.json(), {"initialized": True, "inserted": {"users": 8}}
                )
                operation.assert_awaited_once_with(dev.engine)
        security = app.openapi()["paths"][PATH]["post"]["security"]
        self.assertEqual(security, [{"DatabaseResetKey": []}])


class DatabaseInitTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("TEST_DATABASE_URL")
        if not raw:
            raise unittest.SkipTest("Set TEST_DATABASE_URL for database reset tests")
        url = make_url(raw).set(drivername="postgresql+psycopg")
        cls.root_engine = create_engine(url)
        cls.addClassCleanup(cls.root_engine.dispose)
        cls.schema = f"test_init_{uuid4().hex}"
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema))
        cls.addClassCleanup(cls.drop_schema)
        cls.url = url.update_query_dict({"options": f"-csearch_path={cls.schema}"})

    @classmethod
    def drop_schema(cls):
        with cls.root_engine.begin() as connection:
            connection.execute(DropSchema(cls.schema, cascade=True, if_exists=True))

    async def asyncSetUp(self):
        self.engine = create_async_engine(self.url)
        self.addAsyncCleanup(self.engine.dispose)
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        self.environment = {
            "IS_LOCAL": "false",
            "DATABASE_RESET_KEY": secrets.token_urlsafe(48),
            "JWT_SECRET_KEY": secrets.token_urlsafe(48),
            **{
                f"SEED_{role.upper()}_PASSWORD": secrets.token_urlsafe(24)
                for role in ("admin", "employee", "engineer")
            },
        }
        environment = patch.dict(os.environ, self.environment)
        environment.start()
        self.addCleanup(environment.stop)
        engine = patch.object(dev, "engine", self.engine)
        engine.start()
        self.addCleanup(engine.stop)

        async def session():
            async with self.factory() as value:
                yield value

        app.dependency_overrides[get_session] = session
        self.addCleanup(app.dependency_overrides.pop, get_session)
        self.client = AsyncClient(transport=ASGITransport(app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)
        self.headers = {"X-Database-Reset-Key": self.environment["DATABASE_RESET_KEY"]}

    async def initialize(self):
        response = await self.client.post(PATH, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["inserted"]["users"], 8)
        self.assertEqual(response.json()["inserted"]["incidents"], 120)
        return response

    async def test_reset_replaces_data_preserves_unrelated_tables_and_rejects_old_logins(
        self,
    ):
        await self.initialize()
        login = await self.client.post(
            "/auth/login",
            json={
                "email": "admin@acme.inc",
                "password": self.environment["SEED_ADMIN_PASSWORD"],
            },
        )
        self.assertEqual(login.status_code, 200, login.text)
        tokens = login.json()
        async with self.factory.begin() as session:
            user = User(
                name="Previous employee",
                email="previous@acme.inc",
                password_hash=secrets.token_urlsafe(24),
            )
            session.add(user)
            session.add(Building(name="Discard this custom building"))
            await session.flush()
            previous_id = user.id
        previous_token = create_access_token(previous_id, get_security_settings())
        async with self.engine.begin() as connection:
            await connection.execute(
                text("CREATE TABLE unrelated_example (id integer)")
            )
            await connection.execute(text("INSERT INTO unrelated_example VALUES (7)"))
        await self.initialize()
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(User)), 8
            )
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Incident)), 120
            )
            self.assertIsNone(
                await session.scalar(
                    select(Building).where(
                        Building.name == "Discard this custom building"
                    )
                )
            )
            self.assertGreater(
                await session.scalar(select(func.min(User.id))), previous_id
            )
        async with self.engine.connect() as connection:
            self.assertEqual(
                await connection.scalar(text("SELECT id FROM unrelated_example")), 7
            )
        for token in (tokens["access_token"], previous_token):
            response = await self.client.get(
                "/auth/me", headers={"Authorization": f"Bearer {token}"}
            )
            self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
                )
            ).status_code,
            401,
        )
        for role in ("admin", "employee", "engineer"):
            response = await self.client.post(
                "/auth/login",
                json={
                    "email": f"{role}@acme.inc",
                    "password": self.environment[f"SEED_{role.upper()}_PASSWORD"],
                },
            )
            self.assertEqual(response.status_code, 200, response.text)

    async def test_failed_seed_rolls_back_the_entire_reset(self):
        await self.initialize()
        async with self.factory.begin() as session:
            session.add(Building(name="Preserve this custom building"))
        async with self.factory() as session:
            previous_ids = (
                await session.scalars(select(User.id).order_by(User.id))
            ).all()
        original = reset.seed_database
        private = secrets.token_urlsafe(24)

        async def fail_after_seeding(session):
            await original(session)
            raise RuntimeError(private)

        with (
            patch.object(reset, "seed_database", side_effect=fail_after_seeding),
            self.assertLogs("backend.app.errors", level="ERROR") as logs,
        ):
            response = await self.client.post(PATH, headers=self.headers)
        self.assertEqual(response.status_code, 500, response.text)
        self.assertNotIn(private, response.text + str(logs.output))
        async with self.factory() as session:
            self.assertEqual(
                (await session.scalars(select(User.id).order_by(User.id))).all(),
                previous_ids,
            )
            self.assertIsNotNone(
                await session.scalar(
                    select(Building).where(
                        Building.name == "Preserve this custom building"
                    )
                )
            )

    async def test_invalid_cloud_seed_passwords_leave_schema_unmodified(self):
        with patch.dict(os.environ, {"SEED_ADMIN_PASSWORD": secrets.token_hex(2)}):
            response = await self.client.post(PATH, headers=self.headers)
        self.assertEqual(response.status_code, 422, response.text)
        async with self.engine.connect() as connection:
            self.assertFalse(
                await connection.run_sync(lambda sync: inspect(sync).has_table("users"))
            )

    async def test_concurrent_resets_finish_with_one_complete_dataset(self):
        responses = await asyncio.gather(
            *(self.client.post(PATH, headers=self.headers) for _ in range(2))
        )
        self.assertTrue(
            all(response.status_code == 200 for response in responses),
            [response.text for response in responses],
        )
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(User)), 8
            )
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Incident)), 120
            )


if __name__ == "__main__":
    unittest.main()

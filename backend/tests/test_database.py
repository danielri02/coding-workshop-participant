"""Database configuration and async maintenance tests in an isolated schema."""

import asyncio
import os
import secrets
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from argon2 import PasswordHasher
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.app.database.config import DEFAULT_DATABASE_URL, get_database_url
from backend.app.database.diagnostics import connection_summary, database_error_message
from backend.app.database.session import get_session
from backend.app.models import (
    Base,
    Building,
    EngineerProfile,
    Incident,
    IncidentStatus,
    Note,
    User,
)
from backend.scripts.create_tables import initialize_database
from backend.scripts.seed_database import (
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_EMPLOYEE_EMAIL,
    DEFAULT_EMPLOYEE_PASSWORD,
    DEFAULT_ENGINEER_PASSWORD,
    seed_database,
)


class DatabaseConfigTests(unittest.TestCase):
    """URL validation must preserve options without exposing secrets in errors."""

    def test_default_uses_local_async_capable_driver(self) -> None:
        """Use the database prepared during environment onboarding by default."""

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_database_url(), make_url(DEFAULT_DATABASE_URL))

    def test_workshop_settings_escape_credentials_and_select_local_tls(self) -> None:
        """Injected Lambda DB components are used without manual URL escaping."""

        credential = "p@ss:/?#" + secrets.token_hex(4)
        with patch.dict(
            os.environ,
            {
                "POSTGRES_HOST": "172.17.0.1",
                "POSTGRES_PORT": "5433",
                "POSTGRES_NAME": "incidents",
                "POSTGRES_USER": "a@user",
                "POSTGRES_PASS": credential,
                "IS_LOCAL": "true",
            },
            clear=True,
        ):
            url = get_database_url()
            self.assertEqual(url.host, "172.17.0.1")
            self.assertEqual(url.port, 5433)
            self.assertEqual(url.database, "incidents")
            self.assertEqual(url.username, "a@user")
            self.assertEqual(url.password, credential)
            self.assertEqual(url.query["sslmode"], "disable")
            os.environ["IS_LOCAL"] = "false"
            self.assertEqual(get_database_url().query["sslmode"], "require")
            os.environ["DATABASE_URL"] = "postgresql://override@localhost/other"
            self.assertEqual(get_database_url().database, "other")
            self.assertNotIn("sslmode", get_database_url().query)

    def test_component_settings_fail_without_exposing_values(self) -> None:
        """Reject invalid modes/ports and missing nonlocal credentials."""

        for environment in (
            {"POSTGRES_PORT": "private"},
            {"POSTGRES_PORT": "70000"},
            {"IS_LOCAL": "invalid"},
            {"IS_LOCAL": "false"},
        ):
            with (
                self.subTest(environment=environment),
                patch.dict(os.environ, environment, clear=True),
                self.assertRaises(ValueError),
            ):
                get_database_url()

    def test_plain_postgres_urls_are_normalized_and_preserve_options(self) -> None:
        """Support conventional deployment URLs and SSL settings with psycopg 3."""

        for scheme in ("postgres", "postgresql", "postgresql+psycopg"):
            with (
                self.subTest(scheme=scheme),
                patch.dict(
                    os.environ,
                    {
                        "DATABASE_URL": f"{scheme}://user:p%40ss@db.example/app?sslmode=require"
                    },
                ),
            ):
                url = get_database_url()
                self.assertEqual(url.drivername, "postgresql+psycopg")
                self.assertEqual(url.password, "p@ss")
                self.assertEqual(url.query["sslmode"], "require")

    def test_invalid_urls_are_rejected_without_echoing_input(self) -> None:
        """Reject unsupported drivers and missing database names with safe errors."""

        for value in (
            "",
            "invalid-private-value",
            "sqlite:///test.db",
            "postgresql+asyncpg://db/app",
            "postgresql://db",
        ):
            with (
                self.subTest(value=value),
                patch.dict(os.environ, {"DATABASE_URL": value}),
            ):
                with self.assertRaises(ValueError) as result:
                    get_database_url()
                if value:
                    self.assertNotIn(value, str(result.exception))


class DatabaseDiagnosticTests(unittest.TestCase):
    """Connection failures must be useful without exposing credentials or SQL."""

    def test_summary_reports_configuration_source_and_omits_secrets(self) -> None:
        """Report the target, preserving privacy for password and query values."""

        private_value = secrets.token_urlsafe(24)
        url = make_url(DEFAULT_DATABASE_URL).set(password=private_value)
        url = url.update_query_dict({"sslpassword": private_value})
        for environment, expected in (
            ({}, "DEFAULT_DATABASE_URL"),
            ({"POSTGRES_HOST": "configured"}, "workshop POSTGRES_*"),
            ({"DATABASE_URL": "configured"}, "DATABASE_URL environment variable"),
        ):
            with (
                self.subTest(source=expected),
                patch.dict(os.environ, environment, clear=True),
            ):
                summary = connection_summary(url)
                self.assertIn(expected, summary)
                self.assertIn(f"Database: {url.database}", summary)
                self.assertIn(f"Database role: {url.username}", summary)
                self.assertIn("URL password: configured", summary)
                self.assertNotIn(private_value, summary)
                self.assertNotIn("sslpassword", summary)

    def test_connection_errors_are_actionable_without_echoing_details(self) -> None:
        """Classify libpq errors while excluding arbitrary sensitive details."""

        private_value = secrets.token_urlsafe(24)
        cases = (
            ("no password supplied", "requires a password"),
            ("password authentication failed", "rejected the database role/password"),
            ('role "missing" does not exist', "role does not exist"),
            ('database "missing" does not exist', "database does not exist"),
            ("no pg_hba.conf entry", "authentication rules"),
            ("peer authentication failed", "authentication rules"),
            ("permission denied for schema public", "permissions"),
            ('relation "users" does not exist', "create_tables"),
            ("connection refused", "running and listening"),
            ("could not translate host name", "hostname could not be resolved"),
            ("connection timed out", "timed out"),
            ("certificate verify failed", "trusted CA"),
            ("server does not support SSL", "TLS settings"),
            ("unrecognized connection failure", "Database operation failed"),
        )
        for detail, expected in cases:
            with self.subTest(detail=detail):
                error = OperationalError(
                    f"SELECT '{private_value}'",
                    {},
                    Exception(f"{detail}; secret={private_value}"),
                )
                message = database_error_message(error)
                self.assertIn(expected, message)
                self.assertNotIn(private_value, message)
                self.assertNotIn("SELECT", message)


class AsyncDatabaseTests(unittest.IsolatedAsyncioTestCase):
    """Exercise scripts and async sessions without changing application tables."""

    @classmethod
    def setUpClass(cls) -> None:
        """Set the search path to a unique test schema for functions and CLI runs."""

        raw_url = os.environ.get("TEST_DATABASE_URL")
        if not raw_url:
            raise unittest.SkipTest(
                "Set TEST_DATABASE_URL to run PostgreSQL integration tests"
            )
        url = make_url(raw_url)
        if url.drivername not in {"postgresql", "postgres", "postgresql+psycopg"}:
            raise ValueError("Database integration tests require PostgreSQL/psycopg")
        url = url.set(drivername="postgresql+psycopg")
        cls.root_engine = create_engine(url)
        cls.addClassCleanup(cls.root_engine.dispose)
        cls.schema_name = f"test_async_database_{uuid4().hex}"
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema_name))
        cls.addClassCleanup(cls.cleanup_schema)
        options = url.query.get("options", "")
        cls.test_url = url.update_query_dict(
            {"options": f"{options} -csearch_path={cls.schema_name}".strip()}
        )

    @classmethod
    def cleanup_schema(cls) -> None:
        """Drop only the schema created for this test class."""

        with cls.root_engine.begin() as connection:
            connection.execute(
                DropSchema(cls.schema_name, cascade=True, if_exists=True)
            )

    async def asyncSetUp(self) -> None:
        """Give each test fresh application tables within the isolated schema."""

        self.engine = create_async_engine(self.test_url)
        self.addAsyncCleanup(self.engine.dispose)
        self.factory = async_sessionmaker(
            self.engine, expire_on_commit=False, autoflush=False
        )
        await initialize_database(self.engine, reset=True)

    async def inserted_user_count(self) -> int:
        """Count users through a fresh session to check transaction outcomes."""

        async with self.factory() as session:
            return await session.scalar(select(func.count()).select_from(User))

    async def test_session_dependency_persists_explicit_commit(self) -> None:
        """A committed write remains readable after the request session closes."""

        with patch("backend.app.database.session.session_factory", self.factory):
            dependency = get_session()
            session = await anext(dependency)
            session.add(
                User(
                    name="Employee", email="employee@acme.inc", password_hash="test" * 8
                )
            )
            await session.commit()
            await dependency.aclose()
        self.assertEqual(await self.inserted_user_count(), 1)

    async def test_session_dependency_rolls_back_uncommitted_writes(self) -> None:
        """The dependency does not implicitly commit a successful request."""

        with patch("backend.app.database.session.session_factory", self.factory):
            dependency = get_session()
            session = await anext(dependency)
            session.add(
                User(
                    name="Employee", email="employee@acme.inc", password_hash="test" * 8
                )
            )
            await session.flush()
            await dependency.aclose()
        self.assertEqual(await self.inserted_user_count(), 0)

    async def test_session_dependency_rolls_back_on_exception(self) -> None:
        """Failed requests cannot leave a partial transaction committed."""

        with patch("backend.app.database.session.session_factory", self.factory):
            dependency = get_session()
            session = await anext(dependency)
            session.add(
                User(
                    name="Employee", email="employee@acme.inc", password_hash="test" * 8
                )
            )
            await session.flush()
            with self.assertRaisesRegex(RuntimeError, "Request failed"):
                await dependency.athrow(RuntimeError("Request failed"))
        self.assertEqual(await self.inserted_user_count(), 0)

    async def test_create_preserves_data_and_reset_only_removes_application_data(
        self,
    ) -> None:
        """Normal creation is additive; reset leaves unrelated tables alone."""

        async with self.engine.begin() as connection:
            await connection.execute(
                text("CREATE TABLE unrelated_fixture (id integer)")
            )
        async with self.factory.begin() as session:
            session.add(Building(name="Existing building"))
        await initialize_database(self.engine)
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Building)), 1
            )
        await initialize_database(self.engine, reset=True)
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Building)), 0
            )
        async with self.engine.connect() as connection:
            tables = await connection.run_sync(
                lambda sync: inspect(sync).get_table_names()
            )
        self.assertIn("unrelated_fixture", tables)
        self.assertTrue(set(Base.metadata.tables).issubset(tables))

    async def test_seed_is_idempotent_and_covers_demo_workflow(self) -> None:
        """Seed every persona, category, status, and a recurring location."""

        async with self.factory() as session:
            counts = await seed_database(session)
            rerun = await seed_database(session)
        self.assertEqual(
            counts,
            {
                "users": 8,
                "engineer_profiles": 4,
                "buildings": 3,
                "floors": 9,
                "seats": 54,
                "incidents": 120,
                "notes": 307,
                "refresh_tokens": 0,
            },
        )
        self.assertTrue(all(value == 0 for value in rerun.values()))
        async with self.factory() as session:
            users = (await session.scalars(select(User))).all()
            self.assertEqual(sum(user.is_admin for user in users), 1)
            for user in users:
                self.assertTrue(
                    await asyncio.to_thread(
                        PasswordHasher().verify,
                        user.password_hash,
                        DEFAULT_ADMIN_PASSWORD
                        if user.is_admin
                        else DEFAULT_ENGINEER_PASSWORD
                        if user.email.startswith("engineer")
                        else DEFAULT_EMPLOYEE_PASSWORD,
                    )
                )
            statuses = set(await session.scalars(select(Incident.status)))
            self.assertEqual(statuses, set(IncidentStatus))

    async def test_demo_employee_has_own_history_and_other_people_have_distinct_work(
        self,
    ) -> None:
        async with self.factory() as session:
            await seed_database(session)
            employee = await session.scalar(
                select(User).where(User.email == DEFAULT_EMPLOYEE_EMAIL)
            )
            self.assertFalse(employee.is_admin)
            self.assertIsNone(await session.get(EngineerProfile, employee.id))
            own = (
                await session.scalars(
                    select(Incident).where(Incident.reporter_id == employee.id)
                )
            ).all()
            others = (
                await session.scalars(
                    select(Incident).where(Incident.reporter_id != employee.id)
                )
            ).all()
            self.assertEqual(len(own), 96)
            self.assertEqual(len(others), 24)
            self.assertEqual({row.status for row in own}, set(IncidentStatus))
            self.assertEqual(
                len({row.assignee_id for row in own if row.assignee_id}), 3
            )
            profiles = (await session.scalars(select(EngineerProfile))).all()
            self.assertEqual({row.is_available for row in profiles}, {True, False})
            authors = set(await session.scalars(select(Note.author_id)))
            self.assertGreaterEqual(len(authors), 4)

    async def test_seed_preserves_existing_edits_and_passwords(self) -> None:
        """Reruns must not undo edited content, availability, or note deletions."""

        async with self.factory() as session:
            await seed_database(session)
            async with session.begin():
                user = await session.scalar(
                    select(User).where(User.email == DEFAULT_EMPLOYEE_EMAIL)
                )
                original_hash = user.password_hash
                user.name = "Updated employee name"
                profile = await session.scalar(select(EngineerProfile))
                profile_id = profile.user_id
                profile.is_available = False
                note = await session.scalar(select(Note).order_by(Note.id))
                await session.delete(note)
            counts = await seed_database(session)
            self.assertTrue(all(value == 0 for value in counts.values()))
        async with self.factory() as session:
            user = await session.scalar(
                select(User).where(User.email == DEFAULT_EMPLOYEE_EMAIL)
            )
            self.assertEqual(user.password_hash, original_hash)
            self.assertEqual(user.name, "Updated employee name")
            self.assertFalse(
                (await session.get(EngineerProfile, profile_id)).is_available
            )
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Note)), 306
            )

    async def test_seed_needs_no_password_environment_and_has_idle_engineer_and_unassigned_queue(
        self,
    ) -> None:
        async with self.factory() as session:
            counts = await seed_database(session)
            self.assertEqual(counts["users"], 8)
            idle = await session.scalar(
                select(User).where(User.email == "engineer4@acme.inc")
            )
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(Incident)
                    .where(Incident.assignee_id == idle.id)
                ),
                0,
            )
            self.assertGreater(
                await session.scalar(
                    select(func.count())
                    .select_from(Incident)
                    .where(
                        Incident.assignee_id.is_(None),
                        Incident.status == IncidentStatus.OPEN,
                    )
                ),
                10,
            )

    async def test_seed_does_not_promote_an_existing_employee(self) -> None:
        """A colliding demo email must not silently gain Engineer capability."""

        async with self.factory.begin() as session:
            session.add(
                User(
                    name="Existing employee",
                    email="engineer@acme.inc",
                    password_hash="test" * 8,
                )
            )
        async with self.factory() as session:
            with self.assertRaisesRegex(ValueError, "refusing to grant a capability"):
                await seed_database(session)
        self.assertEqual(await self.inserted_user_count(), 1)
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(EngineerProfile)),
                0,
            )

    async def test_cloud_seed_requires_explicit_passwords_and_preserves_them_on_rerun(
        self,
    ) -> None:
        with patch.dict(os.environ, {"IS_LOCAL": "false"}, clear=True):
            async with self.factory() as session:
                with self.assertRaisesRegex(ValueError, "SEED_ADMIN_PASSWORD"):
                    await seed_database(session)
        self.assertEqual(await self.inserted_user_count(), 0)
        passwords = {
            role: secrets.token_urlsafe(24)
            for role in ("admin", "employee", "engineer")
        }
        environment = {
            "IS_LOCAL": "false",
            **{
                f"SEED_{role.upper()}_PASSWORD": value
                for role, value in passwords.items()
            },
        }
        with patch.dict(os.environ, environment, clear=True):
            async with self.factory() as session:
                await seed_database(session)
                self.assertTrue(
                    all(count == 0 for count in (await seed_database(session)).values())
                )
                for user in (await session.scalars(select(User))).all():
                    role = (
                        "admin"
                        if user.is_admin
                        else "engineer"
                        if user.email.startswith("engineer")
                        else "employee"
                    )
                    self.assertTrue(
                        await asyncio.to_thread(
                            PasswordHasher().verify, user.password_hash, passwords[role]
                        )
                    )

    async def test_seed_does_not_promote_an_existing_admin_email(self) -> None:
        """An email collision cannot turn a registered employee into an admin."""

        async with self.factory.begin() as session:
            user = User(
                name="Employee", email="admin@acme.inc", password_hash="test" * 8
            )
            session.add(user)
            await session.flush()
            user_id = user.id
        async with self.factory() as session:
            with self.assertRaisesRegex(ValueError, "refusing to grant a capability"):
                await seed_database(session)
        self.assertEqual(await self.inserted_user_count(), 1)
        async with self.factory() as session:
            self.assertFalse((await session.get(User, user_id)).is_admin)

    async def cli(
        self,
        module: str,
        *args: str,
        invocation: str = "root-module",
        database_url: str | None = None,
    ) -> tuple[int, str, str]:
        """Invoke supported module/file entry points against the isolated schema."""

        environment = {
            **os.environ,
            "DATABASE_URL": database_url
            or self.test_url.render_as_string(hide_password=False),
        }
        environment.pop("SEED_PASSWORD", None)
        repository = Path(__file__).resolve().parents[2]
        backend_module = module.removeprefix("backend.")
        directory, command = {
            "root-module": (repository, ["-m", module]),
            "backend-module": (repository / "backend", ["-m", backend_module]),
            "root-file": (repository, [module.replace(".", "/") + ".py"]),
            "backend-file": (
                repository / "backend",
                [backend_module.replace(".", "/") + ".py"],
            ),
        }[invocation]
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            *command,
            *args,
            cwd=directory,
            env=environment,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        return process.returncode, stdout.decode(), stderr.decode()

    async def test_connection_check_entrypoints_preserve_data(self) -> None:
        """Check connectivity from either directory without writing any data."""

        async with self.factory.begin() as session:
            session.add(Building(name="Preserve this building"))
        for invocation in (
            "root-module",
            "backend-module",
            "root-file",
            "backend-file",
        ):
            with self.subTest(invocation=invocation):
                code, stdout, stderr = await self.cli(
                    "backend.scripts.check_database", invocation=invocation
                )
                self.assertEqual(code, 0, stderr)
                self.assertIn("Connection successful.", stdout)
                self.assertIn("DATABASE_URL environment variable", stdout)
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Building)), 1
            )

    async def test_admin_check_distinguishes_missing_and_unprivileged_accounts(
        self,
    ) -> None:
        """Diagnose permission problems without promoting accounts or writing data."""

        module = "backend.scripts.check_database"
        code, _, stderr = await self.cli(module, "--check-admin")
        self.assertEqual(code, 1)
        self.assertIn("Seed admin is missing", stderr)
        async with self.factory.begin() as session:
            session.add(
                User(
                    name="Existing employee",
                    email="admin@acme.inc",
                    password_hash="test" * 8,
                )
            )
        code, _, stderr = await self.cli(module, "--check-admin")
        self.assertEqual(code, 1)
        self.assertIn("lacks Admin capability", stderr)
        async with self.factory.begin() as session:
            user = await session.scalar(
                select(User).where(User.email == "admin@acme.inc")
            )
            self.assertFalse(user.is_admin)
            user.is_admin = True
        code, stdout, stderr = await self.cli(module, "--check-admin")
        self.assertEqual(code, 0, stderr)
        self.assertIn("Seed admin exists with Admin capability", stdout)
        self.assertEqual(await self.inserted_user_count(), 1)

    async def test_missing_database_has_actionable_safe_cli_error(self) -> None:
        """Real connection failures identify a missing database without a traceback."""

        missing_url = self.test_url.set(database=f"missing_{uuid4().hex}")
        code, stdout, stderr = await self.cli(
            "backend.scripts.check_database",
            database_url=missing_url.render_as_string(hide_password=False),
        )
        self.assertEqual(code, 1)
        self.assertIn("database does not exist", stderr)
        self.assertNotIn("Traceback", stdout + stderr)

    async def test_script_entrypoints_from_backend_and_direct_files(self) -> None:
        """Create, seed, and safely reset using each previously failing invocation."""

        create = "backend.scripts.create_tables"
        seed = "backend.scripts.seed_database"
        for invocation in ("backend-module", "backend-file", "root-file"):
            with self.subTest(invocation=invocation):
                code, _, stderr = await self.cli(create, invocation=invocation)
                self.assertEqual(code, 0, stderr)
                code, _, stderr = await self.cli(seed, invocation=invocation)
                self.assertEqual(code, 0, stderr)
                self.assertEqual(await self.inserted_user_count(), 8)
                code, _, stderr = await self.cli(create, invocation=invocation)
                self.assertEqual(code, 0, stderr)
                self.assertEqual(await self.inserted_user_count(), 0)

    async def test_cloud_initialization_cli_preserves_existing_records(self) -> None:
        async with self.factory.begin() as session:
            session.add(Building(name="Keep this data"))
        for invocation in (
            "root-module",
            "backend-module",
            "root-file",
            "backend-file",
        ):
            code, stdout, stderr = await self.cli(
                "backend.scripts.initialize_database", invocation=invocation
            )
            self.assertEqual(code, 0, stderr)
            self.assertIn("existing data preserved", stdout)
        async with self.factory() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(Building)), 1
            )

    async def test_cli_create_tables_always_resets_application_data(self) -> None:
        """A plain script invocation wipes seeded data and supports a fresh reseed."""

        create = "backend.scripts.create_tables"
        seed = "backend.scripts.seed_database"
        code, _, stderr = await self.cli(create)
        self.assertEqual(code, 0, stderr)
        code, stdout, stderr = await self.cli(seed)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(await self.inserted_user_count(), 8)
        code, stdout, stderr = await self.cli(seed)
        self.assertEqual(code, 0, stderr)
        self.assertIn("users=0", stdout)
        code, stdout, stderr = await self.cli(create)
        self.assertEqual(code, 0, stderr)
        self.assertIn("Application tables reset", stdout)
        self.assertEqual(await self.inserted_user_count(), 0)
        code, _, stderr = await self.cli(seed)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(await self.inserted_user_count(), 8)
        code, _, stderr = await self.cli(create, "--reset", "--yes")
        self.assertEqual(code, 0, stderr)
        self.assertEqual(await self.inserted_user_count(), 0)


if __name__ == "__main__":
    unittest.main()

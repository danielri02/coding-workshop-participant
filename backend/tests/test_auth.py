"""HTTP login and refresh-token integration tests in an isolated database schema."""

import asyncio
import os
import secrets
import unittest
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from argon2 import PasswordHasher
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.app.database.session import get_session
from backend.app.main import app
from backend.app.models import RefreshToken, User
from backend.app.security.config import SecuritySettings
from backend.app.security.dependencies import auth_settings
from backend.app.security.jwt import create_access_token, decode_access_token
from backend.app.security.passwords import hash_password, password_needs_rehash
from backend.app.security.refresh_tokens import (
    generate_refresh_token,
    hash_refresh_token,
)
from backend.scripts.create_tables import initialize_database
from backend.scripts.seed_database import DEFAULT_ADMIN_PASSWORD, seed_database


class AuthTests(unittest.IsolatedAsyncioTestCase):
    """Exercise credential verification, refresh persistence, rotation, and replay."""

    @classmethod
    def setUpClass(cls) -> None:
        """Create a unique test schema, leaving existing application state alone."""

        raw_url = os.environ.get("TEST_DATABASE_URL")
        if not raw_url:
            raise unittest.SkipTest("Set TEST_DATABASE_URL to run authentication tests")
        url = make_url(raw_url).set(drivername="postgresql+psycopg")
        cls.root_engine = create_engine(url)
        cls.addClassCleanup(cls.root_engine.dispose)
        cls.schema_name = f"test_auth_{uuid4().hex}"
        with cls.root_engine.begin() as connection:
            connection.execute(CreateSchema(cls.schema_name))
        cls.addClassCleanup(cls.cleanup_schema)
        options = url.query.get("options", "")
        cls.test_url = url.update_query_dict(
            {"options": f"{options} -csearch_path={cls.schema_name}".strip()}
        )

    @classmethod
    def cleanup_schema(cls) -> None:
        """Remove only this class's generated schema."""

        with cls.root_engine.begin() as connection:
            connection.execute(
                DropSchema(cls.schema_name, cascade=True, if_exists=True)
            )

    async def asyncSetUp(self) -> None:
        """Create isolated tables and inject a private signing key and DB sessions."""

        self.engine = create_async_engine(self.test_url)
        self.addAsyncCleanup(self.engine.dispose)
        self.factory = async_sessionmaker(
            self.engine, expire_on_commit=False, autoflush=False
        )
        await initialize_database(self.engine, reset=True)
        self.settings = SecuritySettings(
            jwt_secret_key=SecretStr(secrets.token_urlsafe(48))
        )
        self.password = secrets.token_urlsafe(18)

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
        async with self.factory.begin() as session:
            user = User(
                name="Employee",
                email="employee@acme.inc",
                password_hash=await asyncio.to_thread(hash_password, self.password),
            )
            session.add(user)
            admin = User(
                name="Admin",
                email="test.admin@acme.inc",
                password_hash="test" * 8,
                is_admin=True,
            )
            session.add(admin)
            await session.flush()
            self.user_id = user.id
            self.admin_headers = {
                "Authorization": f"Bearer {create_access_token(admin.id, self.settings)}"
            }

    async def login(self) -> dict[str, object]:
        """Create a valid login session through the actual HTTP endpoint."""

        response = await self.client.post(
            "/auth/login",
            json={"email": " EMPLOYEE@ACME.INC ", "password": self.password},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["pragma"], "no-cache")
        return response.json()

    async def token_count(self) -> int:
        """Count persisted refresh credentials using a fresh transaction."""

        async with self.factory() as session:
            return await session.scalar(select(func.count()).select_from(RefreshToken))

    async def test_login_issues_access_jwt_and_only_persists_refresh_hash(self) -> None:
        """Login normalizes email, signs identity, and keeps raw refresh values out of DB."""

        tokens = await self.login()
        self.assertEqual(tokens["token_type"], "bearer")
        self.assertEqual(tokens["expires_in"], 900)
        self.assertEqual(tokens["refresh_expires_in"], 30 * 86400)
        claims = decode_access_token(tokens["access_token"], self.settings)
        self.assertEqual(claims.user_id, self.user_id)
        async with self.factory() as session:
            record = await session.get(
                RefreshToken, hash_refresh_token(tokens["refresh_token"])
            )
            self.assertEqual(record.user_id, self.user_id)
            self.assertNotEqual(record.token_hash, tokens["refresh_token"])
            self.assertIsNone(record.revoked_at)
            self.assertGreater(record.expires_at, record.created_at)

    async def test_bad_credentials_and_missing_user_share_the_same_error(self) -> None:
        """Failed logins neither enumerate valid accounts nor create token rows."""

        errors = []
        for email in ("employee@acme.inc", "absent@acme.inc"):
            response = await self.client.post(
                "/auth/login",
                json={"email": email, "password": secrets.token_urlsafe(18)},
            )
            self.assertEqual(response.status_code, 401, response.text)
            self.assertEqual(response.headers["www-authenticate"], "Bearer")
            errors.append(response.json())
        self.assertEqual(errors[0], errors[1])
        self.assertEqual(await self.token_count(), 0)

    async def test_corrupt_password_hash_is_a_failed_login_not_a_server_error(
        self,
    ) -> None:
        """A legacy/corrupt stored value cannot crash authentication."""

        async with self.factory.begin() as session:
            user = await session.get(User, self.user_id)
            user.password_hash = secrets.token_hex(16)
        response = await self.client.post(
            "/auth/login",
            json={"email": "employee@acme.inc", "password": self.password},
        )
        self.assertEqual(response.status_code, 401, response.text)

    async def test_login_upgrades_older_argon2_parameters(self) -> None:
        """Successful authentication upgrades cost settings without changing passwords."""

        old_hash = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(
            self.password
        )
        async with self.factory.begin() as session:
            (await session.get(User, self.user_id)).password_hash = old_hash
        await self.login()
        async with self.factory() as session:
            stored = (await session.get(User, self.user_id)).password_hash
            self.assertNotEqual(stored, old_hash)
            self.assertFalse(password_needs_rehash(stored))

    async def test_current_account_is_authenticated_and_reflects_current_capabilities(
        self,
    ) -> None:
        """The UI identity endpoint exposes current roles without password fields."""

        self.assertEqual((await self.client.get("/auth/me")).status_code, 401)
        tokens = await self.login()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        response = await self.client.get("/auth/me", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], self.user_id)
        self.assertFalse(response.json()["is_admin"])
        self.assertNotIn("password", response.json())
        self.assertNotIn("password_hash", response.json())
        async with self.factory.begin() as session:
            (await session.get(User, self.user_id)).is_admin = True
        response = await self.client.get("/auth/me", headers=headers)
        self.assertTrue(response.json()["is_admin"])

    async def test_refresh_rotates_and_preserves_absolute_expiry(self) -> None:
        """Each refresh consumes its old credential and keeps the login's expiry."""

        original = await self.login()
        response = await self.client.post(
            "/auth/refresh", json={"refresh_token": original["refresh_token"]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        rotated = response.json()
        self.assertNotEqual(rotated["access_token"], original["access_token"])
        self.assertNotEqual(rotated["refresh_token"], original["refresh_token"])
        self.assertEqual(
            decode_access_token(rotated["access_token"], self.settings).user_id,
            self.user_id,
        )
        async with self.factory() as session:
            old = await session.get(
                RefreshToken, hash_refresh_token(original["refresh_token"])
            )
            new = await session.get(
                RefreshToken, hash_refresh_token(rotated["refresh_token"])
            )
            self.assertIsNotNone(old.revoked_at)
            self.assertIsNone(new.revoked_at)
            self.assertEqual(old.expires_at, new.expires_at)
            self.assertEqual(old.family_id, new.family_id)

    async def test_swagger_password_flow_authenticates_protected_requests(self) -> None:
        """Swagger Authorize exchanges form credentials for a usable bearer token."""

        specification = (await self.client.get("/openapi.json")).json()
        flow = specification["components"]["securitySchemes"]["OAuth2PasswordBearer"]
        self.assertEqual(flow["flows"]["password"]["tokenUrl"], "auth/token")
        self.assertTrue(specification["paths"]["/users"]["get"]["security"])
        self.assertNotIn("security", specification["paths"]["/users"]["post"])
        response = await self.client.post(
            "/auth/token",
            data={
                "username": " EMPLOYEE@ACME.INC ",
                "password": self.password,
                "grant_type": "password",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["token_type"], "bearer")
        access_token = response.json()["access_token"]
        response = await self.client.get(
            f"/users/{self.user_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["email"], "employee@acme.inc")
        for email in ("not-an-email", "employee@acme.inc"):
            response = await self.client.post(
                "/auth/token",
                data={"username": email, "password": secrets.token_urlsafe(18)},
            )
            self.assertEqual(response.status_code, 401, response.text)

    async def test_seeded_development_admin_can_authorize_in_swagger(self) -> None:
        """The requested short seed credential works without relaxing registration."""

        async with self.factory() as session:
            await seed_database(session, SecretStr(self.password))
        response = await self.client.post(
            "/auth/token",
            data={"username": "admin@acme.inc", "password": DEFAULT_ADMIN_PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.text)
        response = await self.client.get(
            "/users",
            headers={"Authorization": f"Bearer {response.json()['access_token']}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(
            any(
                user["email"] == "admin@acme.inc" and user["is_admin"]
                for user in response.json()
            )
        )
        response = await self.client.post(
            "/users",
            json={
                "name": "Short password",
                "email": "short@acme.inc",
                "password": DEFAULT_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(response.status_code, 422, response.text)

    async def test_logout_revokes_descendants_from_consumed_ancestor(self) -> None:
        """Explicit logout revokes the family without logging out another session."""

        original = await self.login()
        independent = await self.login()
        rotated = (
            await self.client.post(
                "/auth/refresh", json={"refresh_token": original["refresh_token"]}
            )
        ).json()
        response = await self.client.post(
            "/auth/logout", json={"refresh_token": original["refresh_token"]}
        )
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b"")
        self.assertEqual(response.headers["cache-control"], "no-store")
        for value in (original["refresh_token"], rotated["refresh_token"]):
            response = await self.client.post(
                "/auth/refresh", json={"refresh_token": value}
            )
            self.assertEqual(response.status_code, 401, response.text)
        response = await self.client.post(
            "/auth/refresh", json={"refresh_token": independent["refresh_token"]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        # Refresh revocation does not blacklist already issued short-lived JWTs.
        response = await self.client.get(
            f"/users/{self.user_id}",
            headers={"Authorization": f"Bearer {original['access_token']}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        for value in (original["refresh_token"], generate_refresh_token()):
            response = await self.client.post(
                "/auth/logout", json={"refresh_token": value}
            )
            self.assertEqual(response.status_code, 204, response.text)

    async def test_concurrent_logout_and_refresh_leave_no_valid_successor(self) -> None:
        """The shared family lock serializes explicit revocation and rotation."""

        tokens = await self.login()
        refresh_response, logout_response = await asyncio.gather(
            self.client.post(
                "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
            ),
            self.client.post(
                "/auth/logout", json={"refresh_token": tokens["refresh_token"]}
            ),
        )
        self.assertEqual(logout_response.status_code, 204, logout_response.text)
        self.assertIn(refresh_response.status_code, (200, 401), refresh_response.text)
        if refresh_response.status_code == 200:
            response = await self.client.post(
                "/auth/refresh",
                json={"refresh_token": refresh_response.json()["refresh_token"]},
            )
            self.assertEqual(response.status_code, 401, response.text)

    async def test_replay_revokes_the_chain_but_not_other_logins(self) -> None:
        """A reused refresh credential invalidates its successor and only that family."""

        original = await self.login()
        independent = await self.login()
        rotated = (
            await self.client.post(
                "/auth/refresh", json={"refresh_token": original["refresh_token"]}
            )
        ).json()
        response = await self.client.post(
            "/auth/refresh", json={"refresh_token": original["refresh_token"]}
        )
        self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/refresh", json={"refresh_token": rotated["refresh_token"]}
                )
            ).status_code,
            401,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/refresh",
                    json={"refresh_token": independent["refresh_token"]},
                )
            ).status_code,
            200,
        )

    async def test_concurrent_refresh_only_consumes_once(self) -> None:
        """Parallel refresh attempts serialize; replay cannot leave a valid successor."""

        tokens = await self.login()
        first, second = await asyncio.gather(
            self.client.post(
                "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
            ),
            self.client.post(
                "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
            ),
        )
        self.assertEqual(sorted((first.status_code, second.status_code)), [200, 401])
        successor = first.json() if first.status_code == 200 else second.json()
        response = await self.client.post(
            "/auth/refresh", json={"refresh_token": successor["refresh_token"]}
        )
        self.assertEqual(response.status_code, 401, response.text)

    async def test_expired_unknown_and_access_tokens_cannot_refresh(self) -> None:
        """Refresh errors are uniform for expiration, unknown strings, and wrong purpose."""

        tokens = await self.login()
        async with self.factory.begin() as session:
            record = await session.get(
                RefreshToken, hash_refresh_token(tokens["refresh_token"])
            )
            record.created_at = datetime.now(timezone.utc) - timedelta(days=2)
            record.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        for value in (
            tokens["refresh_token"],
            tokens["access_token"],
            generate_refresh_token(),
        ):
            response = await self.client.post(
                "/auth/refresh", json={"refresh_token": value}
            )
            self.assertEqual(response.status_code, 401, response.text)
            self.assertNotIn(value, response.text)

    async def test_user_deletion_revokes_refresh_credentials(self) -> None:
        """Deleting an otherwise unreferenced account cascades its token records."""

        tokens = await self.login()
        self.assertEqual(
            (
                await self.client.delete(
                    f"/users/{self.user_id}", headers=self.admin_headers
                )
            ).status_code,
            204,
        )
        self.assertEqual(await self.token_count(), 0)
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
                )
            ).status_code,
            401,
        )

    async def test_concurrent_user_deletion_and_refresh_do_not_deadlock(self) -> None:
        """Account deletion and token replacement use a consistent parent lock order."""

        tokens = await self.login()
        refresh_response, delete_response = await asyncio.gather(
            self.client.post(
                "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
            ),
            self.client.delete(f"/users/{self.user_id}", headers=self.admin_headers),
        )
        self.assertIn(refresh_response.status_code, (200, 401), refresh_response.text)
        self.assertEqual(delete_response.status_code, 204, delete_response.text)
        self.assertEqual(await self.token_count(), 0)

    async def test_invalid_auth_configuration_fails_closed_on_business_routes(
        self,
    ) -> None:
        """Business routes fail closed while public registration/health remain usable."""

        app.dependency_overrides.pop(auth_settings)
        try:
            with patch.dict(
                os.environ, {"JWT_SECRET_KEY": secrets.token_urlsafe(6)}, clear=True
            ):
                response = await self.client.post(
                    "/auth/login",
                    json={"email": "employee@acme.inc", "password": self.password},
                )
                self.assertEqual(response.status_code, 503, response.text)
                self.assertIn("JWT_SECRET_KEY", response.json()["detail"])
                self.assertNotIn(self.password, response.text)
                response = await self.client.post(
                    "/auth/token",
                    data={"username": "employee@acme.inc", "password": self.password},
                )
                self.assertEqual(response.status_code, 503, response.text)
                self.assertIn("JWT_SECRET_KEY", response.json()["detail"])
                self.assertNotIn(self.password, response.text)
                self.assertEqual((await self.client.get("/users")).status_code, 401)
                response = await self.client.get(
                    "/users",
                    headers=self.admin_headers,
                )
                self.assertEqual(response.status_code, 503, response.text)
                self.assertEqual((await self.client.get("/health")).status_code, 200)
                response = await self.client.post(
                    "/users",
                    json={
                        "name": "Public",
                        "email": "public@acme.inc",
                        "password": self.password,
                    },
                )
                self.assertEqual(response.status_code, 201, response.text)
        finally:
            app.dependency_overrides[auth_settings] = lambda: self.settings

    async def test_development_login_and_refresh_work_without_env_configuration(
        self,
    ) -> None:
        """Authorize the default admin, rotate tokens and access routes with no env."""

        async with self.factory() as session:
            await seed_database(session, SecretStr(self.password))
        app.dependency_overrides.pop(auth_settings)
        try:
            with patch.dict(os.environ, {}, clear=True):
                response = await self.client.post(
                    "/auth/token",
                    data={
                        "username": "admin@acme.inc",
                        "password": DEFAULT_ADMIN_PASSWORD,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                tokens = response.json()
                self.assertEqual(tokens["expires_in"], 15 * 60)
                self.assertEqual(tokens["refresh_expires_in"], 30 * 24 * 60 * 60)
                response = await self.client.post(
                    "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
                )
                self.assertEqual(response.status_code, 200, response.text)
                response = await self.client.get(
                    "/users",
                    headers={
                        "Authorization": f"Bearer {response.json()['access_token']}"
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
        finally:
            app.dependency_overrides[auth_settings] = lambda: self.settings

    async def test_registration_hashes_are_accepted_by_login(self) -> None:
        """The existing registration route uses the shared password implementation."""

        password = secrets.token_urlsafe(18)
        response = await self.client.post(
            "/users",
            json={
                "name": "New employee",
                "email": "new@acme.inc",
                "password": password,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        response = await self.client.post(
            "/auth/login", json={"email": "new@acme.inc", "password": password}
        )
        self.assertEqual(response.status_code, 200, response.text)

    async def test_invalid_request_shapes_are_rejected(self) -> None:
        """Require JSON credentials, reject extras, and keep refresh out of the URL."""

        self.assertEqual(
            (
                await self.client.post(
                    "/auth/login", json={"email": "employee@acme.inc"}
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/login",
                    json={
                        "email": "employee@acme.inc",
                        "password": self.password,
                        "is_admin": True,
                    },
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/refresh", params={"refresh_token": generate_refresh_token()}
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/auth/refresh", json={"refresh_token": "x" * 513}
                )
            ).status_code,
            422,
        )


if __name__ == "__main__":
    unittest.main()

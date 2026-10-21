"""Password, configuration, and JWT validation without a database."""

import os
import secrets
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt
from argon2 import PasswordHasher
from pydantic import SecretStr

from backend.app.security.config import (
    SecurityConfigurationError,
    SecuritySettings,
    get_security_settings,
)
from backend.app.security.jwt import (
    InvalidAccessToken,
    create_access_token,
    decode_access_token,
)
from backend.app.security.passwords import (
    hash_password,
    password_needs_rehash,
    validate_password,
    verify_password,
)
from backend.app.security.refresh_tokens import (
    generate_refresh_token,
    hash_refresh_token,
)


class PasswordTests(unittest.TestCase):
    """Passwords use salted Argon2 hashes and malformed hashes fail safely."""

    def test_hashes_are_salted_and_verify(self) -> None:
        """Equal passwords produce distinct hashes and only the right input verifies."""

        password = secrets.token_urlsafe(18)
        first = hash_password(password)
        second = hash_password(password)
        self.assertNotEqual(first, second)
        self.assertNotIn(password, first)
        self.assertTrue(first.startswith("$argon2id$"))
        self.assertTrue(verify_password(password, first))
        self.assertFalse(verify_password(secrets.token_urlsafe(18), first))
        self.assertFalse(password_needs_rehash(first))

    def test_invalid_hash_and_bounded_verification(self) -> None:
        """Corrupt/unsupported hashes and oversized passwords do not raise."""

        for stored in ("", "invalid", "$argon2id$broken"):
            with self.subTest(stored=stored):
                self.assertFalse(verify_password("p" * 12, stored))
                self.assertFalse(password_needs_rehash(stored))
        self.assertFalse(verify_password("", "invalid"))
        self.assertFalse(verify_password("p" * 129, "invalid"))

    def test_creation_policy_preserves_spaces(self) -> None:
        """Creation requires nonblank 12–128 characters without password trimming."""

        for password in ("p" * 11, "p" * 129, " " * 12):
            with self.subTest(length=len(password)), self.assertRaises(ValueError):
                validate_password(password)
        password = " " + secrets.token_urlsafe(18) + " "
        validate_password(password)
        stored = hash_password(password)
        self.assertTrue(verify_password(password, stored))
        self.assertFalse(verify_password(password.strip(), stored))

    def test_legacy_argon2_costs_need_rehash(self) -> None:
        """Weaker existing Argon2 settings can be upgraded on successful login."""

        stored = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(
            secrets.token_urlsafe(18)
        )
        self.assertTrue(password_needs_rehash(stored))


class SecurityConfigTests(unittest.TestCase):
    """Token configuration has safe defaults and no fallback signing key."""

    def test_signing_key_is_required_and_hidden(self) -> None:
        """No token can be signed with an absent, short, or blank default secret."""

        for key in ("", "short", " " * 40):
            with (
                patch.dict(os.environ, {"JWT_SECRET_KEY": key}, clear=True),
                self.assertRaises(SecurityConfigurationError),
            ):
                get_security_settings()
        secret = secrets.token_urlsafe(48)
        with patch.dict(os.environ, {"JWT_SECRET_KEY": secret}, clear=True):
            settings = get_security_settings()
        self.assertNotIn(secret, repr(settings))
        self.assertEqual(settings.access_token_minutes, 15)
        self.assertEqual(settings.refresh_token_days, 30)

    def test_lifetimes_are_configurable_and_validated(self) -> None:
        """Bound configured lifetimes and reject invalid numeric input."""

        base = {"JWT_SECRET_KEY": secrets.token_urlsafe(48)}
        with patch.dict(
            os.environ,
            {
                **base,
                "ACCESS_TOKEN_EXPIRE_MINUTES": str(20),
                "REFRESH_TOKEN_EXPIRE_DAYS": str(7),
            },
            clear=True,
        ):
            settings = get_security_settings()
            self.assertEqual(
                (settings.access_token_minutes, settings.refresh_token_days), (20, 7)
            )
        for field, value in (
            ("ACCESS_TOKEN_EXPIRE_MINUTES", "0"),
            ("ACCESS_TOKEN_EXPIRE_MINUTES", "invalid"),
            ("REFRESH_TOKEN_EXPIRE_DAYS", "366"),
        ):
            with (
                self.subTest(field=field, value=value),
                patch.dict(os.environ, {**base, field: value}, clear=True),
                self.assertRaises(SecurityConfigurationError),
            ):
                get_security_settings()


class AccessTokenTests(unittest.TestCase):
    """JWT consumers must reject expiry, tampering, and token-type confusion."""

    def setUp(self) -> None:
        """Use a fresh ephemeral signing key for every test."""

        self.settings = SecuritySettings(
            jwt_secret_key=SecretStr(secrets.token_urlsafe(48))
        )

    def resign(self, token: str, **changes: object) -> str:
        """Produce signed altered claims to test validations beyond the signature."""

        claims = jwt.decode(
            token,
            self.settings.jwt_secret_key.get_secret_value(),
            algorithms=["HS256"],
            audience=self.settings.audience,
        )
        return jwt.encode(
            {**claims, **changes},
            self.settings.jwt_secret_key.get_secret_value(),
            algorithm="HS256",
        )

    def test_access_token_round_trip(self) -> None:
        """Access tokens contain identity and strict lifetimes, with no roles."""

        token = create_access_token(1, self.settings)
        decoded = decode_access_token(token, self.settings)
        self.assertEqual(decoded.user_id, 1)
        self.assertEqual(decoded.expires_at - decoded.issued_at, timedelta(minutes=15))
        other = decode_access_token(
            create_access_token(1, self.settings), self.settings
        )
        self.assertNotEqual(decoded.token_id, other.token_id)
        payload = jwt.decode(
            token,
            self.settings.jwt_secret_key.get_secret_value(),
            algorithms=["HS256"],
            audience=self.settings.audience,
        )
        self.assertNotIn("is_admin", payload)
        self.assertNotIn("password_hash", payload)

    def test_expired_and_future_tokens_are_rejected(self) -> None:
        """Both expiry and not-before/issued-at boundaries are verified."""

        for when in (
            datetime.now(timezone.utc) - timedelta(hours=1),
            datetime.now(timezone.utc) + timedelta(hours=1),
        ):
            with self.subTest(when=when), self.assertRaises(InvalidAccessToken):
                decode_access_token(
                    create_access_token(1, self.settings, now=when), self.settings
                )

    def test_wrong_key_algorithm_and_unsigned_tokens_are_rejected(self) -> None:
        """A caller cannot switch the allowed algorithm or signing key."""

        token = create_access_token(1, self.settings)
        other = SecuritySettings(jwt_secret_key=SecretStr(secrets.token_urlsafe(48)))
        with self.assertRaises(InvalidAccessToken):
            decode_access_token(token, other)
        claims = jwt.decode(
            token,
            self.settings.jwt_secret_key.get_secret_value(),
            algorithms=["HS256"],
            audience=self.settings.audience,
        )
        for forged in (
            jwt.encode(claims, "", algorithm="none"),
            jwt.encode(
                claims,
                self.settings.jwt_secret_key.get_secret_value(),
                algorithm="HS384",
            ),
        ):
            with self.assertRaises(InvalidAccessToken):
                decode_access_token(forged, self.settings)

    def test_claim_types_purpose_audience_and_issuer_are_checked(self) -> None:
        """Valid signatures alone do not make a token a valid access credential."""

        token = create_access_token(1, self.settings)
        for changes in (
            {"type": "refresh"},
            {"aud": "other-api"},
            {"iss": "other-issuer"},
            {"sub": "-1"},
            {"sub": "2147483648"},
            {"sub": "١"},
            {"jti": ""},
            {"iat": True},
            {"iat": "0"},
            {"exp": []},
        ):
            with self.subTest(changes=changes), self.assertRaises(InvalidAccessToken):
                decode_access_token(self.resign(token, **changes), self.settings)
        claims = jwt.decode(
            token,
            self.settings.jwt_secret_key.get_secret_value(),
            algorithms=["HS256"],
            audience=self.settings.audience,
        )
        for field in ("exp", "sub", "type", "jti", "iat", "nbf", "iss", "aud"):
            missing = {key: value for key, value in claims.items() if key != field}
            with self.subTest(missing=field), self.assertRaises(InvalidAccessToken):
                decode_access_token(
                    jwt.encode(
                        missing,
                        self.settings.jwt_secret_key.get_secret_value(),
                        algorithm="HS256",
                    ),
                    self.settings,
                )

    def test_opaque_refresh_and_malformed_tokens_are_not_access_tokens(self) -> None:
        """A refresh credential or arbitrary string cannot be used as an access JWT."""

        for token in ("", "invalid", generate_refresh_token(), "a" * 4097):
            with self.subTest(length=len(token)), self.assertRaises(InvalidAccessToken):
                decode_access_token(token, self.settings)

    def test_refresh_generation_and_hashing(self) -> None:
        """Refresh values are random, stable to hash, and never equal their hashes."""

        first, second = generate_refresh_token(), generate_refresh_token()
        self.assertEqual(len(first), 64)
        self.assertNotEqual(first, second)
        self.assertEqual(hash_refresh_token(first), hash_refresh_token(first))
        self.assertEqual(len(hash_refresh_token(first)), 64)
        self.assertNotEqual(hash_refresh_token(first), first)


if __name__ == "__main__":
    unittest.main()

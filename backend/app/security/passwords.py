"""Argon2 password hashing, verification, and registration policy."""

import secrets
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def validate_password(password: str) -> None:
    """Require 12–128 characters without stripping meaningful password spaces."""

    if (
        not isinstance(password, str)
        or not 12 <= len(password) <= 128
        or not password.strip()
    ):
        raise ValueError("Password must be 12–128 characters and not only whitespace")


def hash_password(password: str) -> str:
    """Hash a password; creation policy is validated separately by input schemas."""

    if not isinstance(password, str) or not 1 <= len(password) <= 128:
        raise ValueError("Password must contain between 1 and 128 characters")
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Return false for wrong passwords and malformed/unsupported stored hashes."""

    if not isinstance(password, str) or not 1 <= len(password) <= 128:
        return False
    if not isinstance(password_hash, str) or not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """Identify valid Argon2 hashes whose cost parameters need upgrading."""

    if not isinstance(password_hash, str) or not password_hash:
        return False
    try:
        return _hasher.check_needs_rehash(password_hash)
    except (VerificationError, InvalidHashError):
        return False


@lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """Use a process-local random hash to verify even when an account is absent."""

    return hash_password(secrets.token_urlsafe(32))

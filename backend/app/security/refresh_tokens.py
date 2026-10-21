"""Issuance, rotation, and replay revocation of persistent refresh credentials."""

import hashlib
import math
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.crud import commit
from backend.app.models import RefreshToken, User
from backend.app.schemas.auth import TokenPair

from .config import SecuritySettings
from .jwt import create_access_token


def generate_refresh_token() -> str:
    """Generate 384 bits of entropy as a URL-safe opaque credential."""

    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """Store only a SHA-256 digest of a high-entropy refresh credential."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token_pair(
    session: AsyncSession,
    user_id: int,
    settings: SecuritySettings,
    *,
    now: datetime | None = None,
    family_id: UUID | None = None,
    refresh_expires_at: datetime | None = None,
) -> TokenPair:
    """Stage a refresh hash and issue tokens; the caller commits atomically."""

    now = now or datetime.now(timezone.utc)
    expires_at = refresh_expires_at or now + timedelta(days=settings.refresh_token_days)
    if expires_at <= now:
        raise ValueError("Refresh-token lifetime must be positive")
    raw_token = generate_refresh_token()
    session.add(
        RefreshToken(
            token_hash=hash_refresh_token(raw_token),
            user_id=user_id,
            family_id=family_id or uuid4(),
            created_at=now,
            expires_at=expires_at,
        )
    )
    return TokenPair(
        access_token=create_access_token(user_id, settings, now=now),
        refresh_token=raw_token,
        expires_in=settings.access_token_minutes * 60,
        refresh_expires_in=math.ceil((expires_at - now).total_seconds()),
    )


async def revoke_refresh_family(
    session: AsyncSession, family_id: UUID, now: datetime
) -> None:
    """Revoke a login's refresh chain inside the caller's locked transaction."""

    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    )


def invalid_refresh_token() -> HTTPException:
    """Return a uniform error without disclosing token existence or revocation."""

    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Invalid or expired refresh token",
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


async def rotate_refresh_token(
    session: AsyncSession, raw_token: str, settings: SecuritySettings
) -> TokenPair:
    """Consume once, preserve absolute expiry, and revoke the chain on replay.

    A transaction-level family lock serializes rotation with replay revocation,
    including requests using different generations of the same login's tokens.
    Revoked hashes remain until expiry so reuse can be detected after rotation.
    """

    token_hash = hash_refresh_token(raw_token)
    record = await session.get(RefreshToken, token_hash)
    if record is None:
        raise invalid_refresh_token()
    lock_id = int.from_bytes(record.family_id.bytes[:8], byteorder="big", signed=True)
    await session.execute(select(func.pg_advisory_xact_lock(lock_id)))
    # Lock the parent before its token row so concurrent account deletion can
    # finish or wait without a user/token lock-order inversion during FK checks.
    user_id = await session.scalar(
        select(User.id)
        .where(User.id == record.user_id)
        .with_for_update(read=True, key_share=True)
    )
    if user_id is None:
        raise invalid_refresh_token()
    record = await session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if record is None:
        raise invalid_refresh_token()
    now = datetime.now(timezone.utc)
    if record.revoked_at is not None:
        await revoke_refresh_family(session, record.family_id, now)
        await commit(session)
        raise invalid_refresh_token()
    if record.expires_at <= now:
        record.revoked_at = now
        await commit(session)
        raise invalid_refresh_token()
    record.revoked_at = now
    tokens = issue_token_pair(
        session,
        record.user_id,
        settings,
        now=now,
        family_id=record.family_id,
        refresh_expires_at=record.expires_at,
    )
    await commit(session)
    return tokens

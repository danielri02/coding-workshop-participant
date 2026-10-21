"""Shared incident visibility and operation-specific authorization rules."""

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import or_, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.interfaces import ORMOption
from sqlalchemy.sql.elements import ColumnElement

from ..database import crud
from ..domain.incidents import ACTIVE_STATUSES
from ..models import Incident, User


def incident_visibility(user: User) -> ColumnElement[bool]:
    """Combine employee, current-engineer-assignment, and admin read grants."""

    if user.is_admin:
        return true()
    own_reports = Incident.reporter_id == user.id
    if user.engineer_profile is not None:
        return or_(own_reports, Incident.assignee_id == user.id)
    return own_reports


def require_incident_view(user: User, incident: Incident) -> None:
    """Use the same additive read rules for incident and note details."""

    if not (
        user.is_admin
        or incident.reporter_id == user.id
        or (user.engineer_profile is not None and incident.assignee_id == user.id)
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Incident access denied")


async def accessible_incident(
    session: AsyncSession,
    incident_id: int,
    user: User,
    *,
    for_update: bool = False,
    options: Sequence[ORMOption] = (),
) -> Incident:
    """Load and authorize an incident, locking before write-time access checks."""

    incident = await crud.get_record(
        session, Incident, incident_id, for_update=for_update, options=options
    )
    require_incident_view(user, incident)
    return incident


def require_incident_worker(user: User, incident: Incident) -> None:
    """Allow status changes only for admins and currently assigned engineers."""

    if not (
        user.is_admin
        or (user.engineer_profile is not None and incident.assignee_id == user.id)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Admin or assigned Engineer capability required"
        )


def require_priority_access(user: User, incident: Incident) -> None:
    """Allow admins on any state and reporters on their own active incidents."""

    if not user.is_admin and not (
        incident.reporter_id == user.id and incident.status in ACTIVE_STATUSES
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Priority changes require Admin capability or an own active incident",
        )


def require_account_access(user: User, user_id: int) -> None:
    """Limit account details/edits to the account owner or an admin."""

    if not user.is_admin and user.id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account access denied")

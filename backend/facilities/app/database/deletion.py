"""Preview and atomically delete a business record and its dependent records."""

import hashlib
import json
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import case, delete, false, inspect, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.incidents import ACTIVE_STATUSES
from ..models import Base, Building, EngineerProfile, Floor, Incident, Note, Seat, User
from ..models.enums import IncidentStatus
from ..schemas.deletion import DeletionPreview

RESOURCES = {
    "users": User,
    "engineer-profiles": EngineerProfile,
    "buildings": Building,
    "floors": Floor,
    "seats": Seat,
    "incidents": Incident,
    "notes": Note,
}
TABLES = {
    "users": User,
    "engineers": EngineerProfile,
    "buildings": Building,
    "floors": Floor,
    "seats": Seat,
    "incidents": Incident,
    "notes": Note,
}


@dataclass
class DeletionPlan:
    preview: DeletionPreview
    records: dict[str, list[int]]
    unassign: list[int]

    @property
    def cascades(self) -> bool:
        return sum(self.preview.counts.values()) > 1 or bool(self.unassign)


async def plan_deletion(
    session: AsyncSession, record: Base, *, lock: bool = False
) -> DeletionPlan:
    """Lock affected parents before descendants so new references cannot bypass confirmation."""

    model = type(record)
    primary = inspect(model).primary_key[0]
    record_id = getattr(record, primary.key)
    resource = next(name for name, table in RESOURCES.items() if table is model)
    records = {name: [] for name in TABLES}

    async def ids(table: type[Base], condition) -> list[int]:
        column = inspect(table).primary_key[0]
        statement = select(column).where(condition).order_by(column)
        if lock:
            statement = statement.with_for_update()
        return list(await session.scalars(statement))

    records["users"] = [record_id] if model is User else []
    records["engineers"] = (
        await ids(EngineerProfile, EngineerProfile.user_id == record_id)
        if model in {User, EngineerProfile}
        else []
    )
    records["buildings"] = [record_id] if model is Building else []
    records["floors"] = (
        await ids(Floor, Floor.building_id == record_id)
        if model is Building
        else [record_id]
        if model is Floor
        else []
    )
    records["seats"] = (
        await ids(Seat, Seat.floor_id.in_(records["floors"]))
        if records["floors"]
        else [record_id]
        if model is Seat
        else []
    )
    incident_condition = {
        Building: Incident.building_id == record_id,
        Floor: Incident.floor_id == record_id,
        Seat: Incident.seat_id == record_id,
        User: Incident.reporter_id == record_id,
        Incident: Incident.id == record_id,
    }.get(model, false())
    assignment_condition = Incident.assignee_id.in_(records["engineers"])
    # Lock all incident parents in ID order, whether deleted or merely unassigned.
    affected = await ids(Incident, or_(incident_condition, assignment_condition))
    records["incidents"] = (
        list(
            await session.scalars(
                select(Incident.id).where(Incident.id.in_(affected), incident_condition)
            )
        )
        if affected
        else []
    )
    unassign = sorted(set(affected) - set(records["incidents"]))
    records["notes"] = await ids(
        Note,
        or_(
            Note.incident_id.in_(records["incidents"]),
            Note.author_id.in_(records["users"]),
            Note.id == record_id if model is Note else false(),
        ),
    )
    payload = {
        "resource": resource,
        "record_id": record_id,
        "records": {key: sorted(value) for key, value in records.items()},
        "unassign": unassign,
    }
    token = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return DeletionPlan(
        DeletionPreview(
            resource=resource,
            record_id=record_id,
            counts={key: len(value) for key, value in records.items() if value},
            unassigned_incidents=len(unassign),
            confirmation_token=token,
        ),
        records,
        unassign,
    )


async def delete_with_dependents(
    session: AsyncSession, record: Base, confirmation: str | None
) -> None:
    """Delete children before parents in one transaction; keep other engineers' work."""

    plan = await plan_deletion(session, record, lock=True)
    if (plan.cascades or confirmation is not None) and (
        confirmation != plan.preview.confirmation_token
    ):
        raise HTTPException(
            409,
            "Review the current deletion preview and confirm again before deleting related records.",
        )
    try:
        if plan.unassign:
            await session.execute(
                update(Incident)
                .where(Incident.id.in_(plan.unassign))
                .values(
                    assignee_id=None,
                    status=case(
                        (Incident.status.in_(ACTIVE_STATUSES), IncidentStatus.OPEN),
                        else_=Incident.status,
                    ),
                    blocked_reason=None,
                )
            )
        for key in (
            "notes",
            "incidents",
            "seats",
            "floors",
            "buildings",
            "engineers",
            "users",
        ):
            if plan.records[key]:
                table = TABLES[key]
                await session.execute(
                    delete(table).where(
                        inspect(table).primary_key[0].in_(plan.records[key])
                    )
                )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            409, "Related records changed. Review the deletion preview and try again."
        ) from None

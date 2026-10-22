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

    # Start with the selected record, then collect children from parent to child.
    if model is User:
        records["users"] = [record_id]
        records["engineers"] = await ids(
            EngineerProfile, EngineerProfile.user_id == record_id
        )
    elif model is EngineerProfile:
        records["engineers"] = await ids(
            EngineerProfile, EngineerProfile.user_id == record_id
        )
    elif model is Building:
        records["buildings"] = [record_id]
        records["floors"] = await ids(Floor, Floor.building_id == record_id)
    elif model is Floor:
        records["floors"] = [record_id]
    elif model is Seat:
        records["seats"] = [record_id]

    if records["floors"]:
        records["seats"] = await ids(Seat, Seat.floor_id.in_(records["floors"]))

    # A deleted account owns its reports. A removed engineer profile only
    # unassigns work, so it deliberately has no incident-deletion condition.
    incident_condition = false()
    if model is Building:
        incident_condition = Incident.building_id == record_id
    elif model is Floor:
        incident_condition = Incident.floor_id == record_id
    elif model is Seat:
        incident_condition = Incident.seat_id == record_id
    elif model is User:
        incident_condition = Incident.reporter_id == record_id
    elif model is Incident:
        incident_condition = Incident.id == record_id

    assignment_condition = Incident.assignee_id.in_(records["engineers"])
    # Lock all incident parents in ID order, whether deleted or merely unassigned.
    affected = await ids(Incident, or_(incident_condition, assignment_condition))
    if affected:
        records["incidents"] = list(
            await session.scalars(
                select(Incident.id).where(Incident.id.in_(affected), incident_condition)
            )
        )
    unassign = sorted(set(affected) - set(records["incidents"]))

    note_conditions = [
        Note.incident_id.in_(records["incidents"]),
        Note.author_id.in_(records["users"]),
    ]
    if model is Note:
        note_conditions.append(Note.id == record_id)
    records["notes"] = await ids(Note, or_(*note_conditions))
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

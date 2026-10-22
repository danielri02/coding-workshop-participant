"""Atomic incident consolidation with ordered locks and a retained merge trail."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, IncidentStatus, Note, Ticket
from . import crud


async def merge_incidents(
    session: AsyncSession, source_id: int, target_id: int, admin_id: int
) -> None:
    if source_id == target_id:
        raise HTTPException(422, "An incident cannot be merged into itself")
    # The same lock order prevents opposite concurrent merges deadlocking.
    records = list(
        await session.scalars(
            select(Incident)
            .where(Incident.id.in_([source_id, target_id]))
            .order_by(Incident.id)
            .with_for_update()
        )
    )
    if len(records) != 2:
        raise HTTPException(404, "Source or target incident not found")
    source = next(row for row in records if row.id == source_id)
    target = next(row for row in records if row.id == target_id)
    if source.merged_into_id is not None or target.merged_into_id is not None:
        raise HTTPException(409, "Choose incidents that have not already been merged")
    if target.status == IncidentStatus.CLOSED:
        raise HTTPException(409, "Reopen the target incident before merging into it")
    await session.execute(
        update(Ticket)
        .where(Ticket.incident_id == source_id)
        .values(incident_id=target_id)
    )
    await session.execute(
        update(Note).where(Note.incident_id == source_id).values(incident_id=target_id)
    )
    source.status = IncidentStatus.CLOSED
    source.blocked_reason = None
    source.merged_into_id = target_id
    source.merged_at = datetime.now(timezone.utc)
    source.merged_by_id = admin_id
    # Target milestones and original Ticket text/location/timestamps are unchanged.
    await crud.commit(session)

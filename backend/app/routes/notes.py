"""Shared incident-note CRUD endpoints."""

from fastapi import APIRouter, HTTPException, Response, status

from ..database import crud
from ..models import Incident, IncidentStatus, Note, User
from ..schemas import NoteCreate, NoteRead, NoteUpdate
from .dependencies import DatabaseSession, QueryID, RecordID

router = APIRouter(tags=[Note.__name__])
ACTIVE_STATUSES = {
    IncidentStatus.OPEN,
    IncidentStatus.IN_PROGRESS,
    IncidentStatus.BLOCKED,
}


@router.get("/incidents/{incident_id}/notes", response_model=list[NoteRead])
async def list_notes(incident_id: RecordID, session: DatabaseSession) -> list[Note]:
    """List every note for an incident, in creation/ID order."""

    await crud.get_record(session, Incident, incident_id)
    return await crud.list_records(
        session,
        Note,
        filters={"incident_id": incident_id},
        order_by=(Note.created_at, Note.id),
    )


@router.post(
    "/incidents/{incident_id}/notes",
    response_model=NoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    incident_id: RecordID,
    payload: NoteCreate,
    author_id: QueryID,
    session: DatabaseSession,
) -> Note:
    """Post to an active incident using an explicit author ID until auth exists."""

    incident = await crud.get_record(session, Incident, incident_id, for_update=True)
    if incident.status not in ACTIVE_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "New notes require an active incident"
        )
    await crud.get_record(session, User, author_id)
    return await crud.create_record(
        session,
        Note,
        {**payload.model_dump(), "incident_id": incident_id, "author_id": author_id},
    )


@router.get("/notes/{note_id}", response_model=NoteRead)
async def get_note(note_id: RecordID, session: DatabaseSession) -> Note:
    """Read one shared incident note."""

    return await crud.get_record(session, Note, note_id)


@router.patch("/notes/{note_id}", response_model=NoteRead)
async def update_note(
    note_id: RecordID, payload: NoteUpdate, session: DatabaseSession
) -> Note:
    """Correct an existing note, including on resolved or closed incidents."""

    record = await crud.get_record(session, Note, note_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(note_id: RecordID, session: DatabaseSession) -> Response:
    """Delete an existing note without deleting its incident."""

    await crud.delete_record(
        session, await crud.get_record(session, Note, note_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

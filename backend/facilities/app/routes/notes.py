"""Shared incident-note CRUD endpoints."""

from fastapi import APIRouter, HTTPException, Response, status

from ..database import crud
from ..domain.incidents import ACTIVE_STATUSES
from ..models import Note
from ..schemas import NoteCreate, NoteRead, NoteUpdate
from ..security.dependencies import AdminUser, CurrentUser
from ..security.permissions import accessible_incident
from .dependencies import NOTE_READ_OPTIONS, DatabaseSession, RecordID

router = APIRouter(tags=[Note.__name__])


@router.get("/incidents/{incident_id}/notes", response_model=list[NoteRead])
async def list_notes(
    incident_id: RecordID, session: DatabaseSession, user: CurrentUser
) -> list[Note]:
    """List every note for an incident, in creation/ID order."""

    await accessible_incident(session, incident_id, user)
    return await crud.list_records(
        session,
        Note,
        filters={"incident_id": incident_id},
        order_by=(Note.created_at, Note.id),
        options=NOTE_READ_OPTIONS,
    )


@router.post(
    "/incidents/{incident_id}/notes",
    response_model=NoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    incident_id: RecordID,
    payload: NoteCreate,
    session: DatabaseSession,
    user: CurrentUser,
) -> Note:
    """Post as the authenticated viewer while the incident remains active."""

    incident = await accessible_incident(session, incident_id, user, for_update=True)
    if incident.status not in ACTIVE_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "New notes require an active incident"
        )
    return await crud.create_record(
        session,
        Note,
        {**payload.model_dump(), "incident_id": incident_id, "author_id": user.id},
        options=NOTE_READ_OPTIONS,
    )


@router.get("/notes/{note_id}", response_model=NoteRead)
async def get_note(
    note_id: RecordID, session: DatabaseSession, user: CurrentUser
) -> Note:
    """Read one shared incident note."""

    note = await crud.get_record(session, Note, note_id, options=NOTE_READ_OPTIONS)
    await accessible_incident(session, note.incident_id, user)
    return note


@router.patch("/notes/{note_id}", response_model=NoteRead)
async def update_note(
    note_id: RecordID, payload: NoteUpdate, session: DatabaseSession, _admin: AdminUser
) -> Note:
    """Correct an existing note, including on resolved or closed incidents."""

    record = await crud.get_record(session, Note, note_id, for_update=True)
    return await crud.update_record(
        session,
        record,
        payload.model_dump(exclude_unset=True),
        options=NOTE_READ_OPTIONS,
    )


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: RecordID, session: DatabaseSession, _admin: AdminUser
) -> Response:
    """Delete an existing note without deleting its incident."""

    await crud.delete_record(
        session, await crud.get_record(session, Note, note_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

"""Shared incident-note CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from ..database import crud
from ..database.grids import grid_records
from ..database.loading import NOTE_READ_OPTIONS
from ..domain.incidents import NOTE_STATUSES
from ..models import Note, User
from ..schemas import NoteCreate, NoteRead, NoteUpdate
from ..schemas.grid import NoteGridQuery, Page
from ..security.dependencies import AdminUser, CurrentUser
from ..security.permissions import accessible_incident, require_incident_worker
from .dependencies import DatabaseSession, DeletionConfirmation, RecordID

router = APIRouter(tags=[Note.__name__])


@router.get("/incidents/{incident_id}/notes", response_model=list[NoteRead])
async def list_notes(
    incident_id: RecordID, session: DatabaseSession, user: CurrentUser
) -> list[Note]:
    """List every note for an incident, newest timestamp/ID first."""

    await accessible_incident(session, incident_id, user)
    return await crud.list_records(
        session,
        Note,
        filters={"incident_id": incident_id},
        order_by=(Note.created_at.desc(), Note.id.desc()),
        options=NOTE_READ_OPTIONS,
    )


@router.get("/incidents/{incident_id}/notes/grid", response_model=Page[NoteRead])
async def grid_notes(
    incident_id: RecordID,
    session: DatabaseSession,
    user: CurrentUser,
    query: Annotated[NoteGridQuery, Query()],
) -> dict:
    """Page the conversation only after checking access to its parent incident."""

    await accessible_incident(session, incident_id, user)
    statement = (
        select(Note)
        .join(User, Note.author_id == User.id)
        .where(Note.incident_id == incident_id)
    )
    return await grid_records(
        session,
        statement,
        query,
        primary_key=Note.id,
        text_columns={"body": Note.body, "author_name": User.name},
        date_columns={"created_at": Note.created_at},
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
    """Only admins/current assigned engineers post, including after resolution, until closure."""

    incident = await accessible_incident(session, incident_id, user, for_update=True)
    require_incident_worker(user, incident)
    if incident.status not in NOTE_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "New notes are not allowed on closed incidents"
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
    note_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Delete an existing note without deleting its incident."""

    await crud.delete_record(
        session,
        await crud.get_record(session, Note, note_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

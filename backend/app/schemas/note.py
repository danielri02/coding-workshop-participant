"""Shared conversation payloads with server-controlled ownership."""

from .base import Body, Name, PatchSchema, PositiveID, Schema, UTCDateTime


class NoteCreate(Schema):
    """Post to an active incident; incident and author come from route/auth context."""

    body: Body


class NoteUpdate(PatchSchema):
    """Admin-only correction, including after the incident is no longer active."""

    body: Body | None = None


class NoteRead(Schema):
    """A shared note, visible within the parent incident's access scope."""

    id: PositiveID
    incident_id: PositiveID
    author_id: PositiveID
    author_name: Name
    body: Body
    created_at: UTCDateTime

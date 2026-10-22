"""Relationships needed by response schemas, without loading private report bodies."""

from sqlalchemy.orm import selectinload

from ..models import Note, Ticket, User

# Incident response values are columns or SQL expressions (name/follower count).
INCIDENT_READ_OPTIONS = ()
# populate_existing reads may encounter the same User as CurrentUser. Keep its
# capability relationship loaded so later permission checks need no implicit IO.
NOTE_READ_OPTIONS = (selectinload(Note.author).selectinload(User.engineer_profile),)
TICKET_READ_OPTIONS = (
    selectinload(Ticket.reporter).selectinload(User.engineer_profile),
    selectinload(Ticket.incident),
)

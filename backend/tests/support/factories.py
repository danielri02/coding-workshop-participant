"""Small fixtures for the report/incident split, without bypassing API permissions."""

from backend.app.models import Incident, Ticket


def reported_incident(*, reporter_id=None, **values) -> Incident:
    """Build an incident and optionally its first report as one ORM graph."""

    incident = Incident(**values)
    if reporter_id is not None:
        fields = {
            key: values[key]
            for key in (
                "title",
                "description",
                "building_id",
                "floor_id",
                "seat_id",
                "created_at",
            )
            if key in values
        }
        incident.tickets = [Ticket(reporter_id=reporter_id, **fields)]
    return incident

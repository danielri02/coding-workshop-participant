"""Incident search and grid ordering shared by both collection endpoints."""

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.sql import SQLColumnExpression

from ..models import Incident, User
from ..schemas.incident import IncidentFilters, IncidentGridQuery
from ..security.permissions import incident_visibility


def incident_criteria(
    query: IncidentFilters, user: User
) -> tuple[dict[str, Any], list[SQLColumnExpression[bool]]]:
    """Intersect structured and literal text filters with the caller's grants."""

    filters = query.model_dump(
        include={
            "reporter_id",
            "assignee_id",
            "building_id",
            "floor_id",
            "seat_id",
            "status",
            "priority",
            "category",
        },
        exclude_none=True,
    )
    conditions = [incident_visibility(user)]
    if query.search and (term := query.search.strip()):
        conditions.append(
            or_(
                Incident.title.icontains(term, autoescape=True),
                Incident.description.icontains(term, autoescape=True),
            )
        )
    if query.escalated is not None:
        conditions.append(
            Incident.escalation_reason.is_not(None)
            if query.escalated
            else Incident.escalation_reason.is_(None)
        )
    return filters, conditions


def incident_order(query: IncidentGridQuery) -> tuple[SQLColumnExpression[Any], ...]:
    """Use validated fields, bound SQL expressions and a stable ID tie-breaker."""

    if query.sort_by == "assignee_name":
        column = (
            select(User.name).where(User.id == Incident.assignee_id).scalar_subquery()
        )
    else:
        column = getattr(Incident, query.sort_by)
    order = column.asc() if query.sort_direction == "asc" else column.desc()
    return order.nulls_last(), Incident.id.asc()

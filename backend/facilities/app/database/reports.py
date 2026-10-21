"""SQL aggregations and paged report rows, scoped before counting or averaging."""

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.incidents import ACTIVE_STATUSES
from ..models import (
    Building,
    EngineerProfile,
    Floor,
    Incident,
    IncidentCategory,
    IncidentPriority,
    IncidentStatus,
    Seat,
    User,
)
from ..schemas.report import ReportQuery, ReportScope
from ..security.permissions import incident_visibility

ACTIVE = Incident.status.in_(ACTIVE_STATUSES)
TICKET_COLUMNS = (
    Incident.id,
    Incident.title,
    Incident.status,
    Incident.priority,
    Incident.category,
    User.name.label("assignee_name"),
    Incident.created_at,
)
DURATIONS = {
    f"{name}_minutes": func.extract("epoch", column - Incident.created_at) / 60
    for name, column in (
        ("assigned", Incident.assigned_at),
        ("acknowledged", Incident.acknowledged_at),
        ("resolved", Incident.resolved_at),
    )
}
SORT_COLUMNS = {
    "id": Incident.id,
    "title": Incident.title,
    "status": Incident.status,
    "priority": Incident.priority,
    "category": Incident.category,
    "created_at": Incident.created_at,
    "assignee_name": User.name,
}


def visibility(user: User, scope: ReportScope):
    """Narrow existing grants for personal/assigned views; never broaden access."""

    if scope == ReportScope.PERSONAL:
        return Incident.reporter_id == user.id
    if scope == ReportScope.ASSIGNED:
        if user.engineer_profile is None:
            raise HTTPException(
                403, "Engineer capability required for assigned reports"
            )
        return Incident.assignee_id == user.id
    return incident_visibility(user)


def criteria(user: User, query: ReportQuery) -> list:
    conditions = [visibility(user, query.scope)]
    if term := query.search.strip():
        conditions.append(
            or_(
                Incident.title.icontains(term, autoescape=True),
                Incident.description.icontains(term, autoescape=True),
            )
        )
    return conditions


async def summary(session: AsyncSession, user: User, scope: ReportScope) -> dict:
    """Count statuses in SQL without loading rows or including another user's work."""

    counts = (
        (
            await session.execute(
                select(
                    func.count().label("total_count"),
                    func.count().filter(ACTIVE).label("active_count"),
                    *[
                        func.count()
                        .filter(Incident.status == state)
                        .label(f"{state.name.lower()}_count")
                        for state in IncidentStatus
                    ],
                )
                .select_from(Incident)
                .where(visibility(user, scope))
            )
        )
        .mappings()
        .one()
    )
    return {"scope": scope, **counts}


def tickets(*extra):
    return (
        select(*TICKET_COLUMNS, *extra)
        .select_from(Incident)
        .outerjoin(User, User.id == Incident.assignee_id)
    )


async def page(
    session: AsyncSession, statement, query: ReportQuery, extra_sorts=None
) -> dict:
    """Count the same filtered rows as the page and enforce an explicit sort allowlist."""

    column = {**SORT_COLUMNS, **(extra_sorts or {})}.get(query.sort_by)
    if column is None:
        raise HTTPException(422, "That sort field is not supported by this report")
    order = column.asc() if query.sort_direction == "asc" else column.desc()
    count = await session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = await session.execute(
        statement.order_by(order.nulls_last(), Incident.id.asc())
        .offset(query.page * query.page_size)
        .limit(query.page_size)
    )
    return {
        "rows": [dict(row) for row in rows.mappings()],
        "row_count": count or 0,
        "page": query.page,
        "page_size": query.page_size,
    }


async def locations(
    session: AsyncSession, user: User, scope: ReportScope, level: str
) -> dict:
    """Recurrence means at least two incidents in the same location/category group."""

    columns = [
        Building.id.label("building_id"),
        Building.name.label("building_name"),
        Incident.category,
    ]
    statement = (
        select()
        .select_from(Incident)
        .join(Building, Building.id == Incident.building_id)
    )
    if level in {"floor", "seat"}:
        statement = statement.join(Floor, Floor.id == Incident.floor_id)
        columns.extend([Floor.id.label("floor_id"), Floor.label.label("floor_label")])
    if level == "seat":
        statement = statement.join(Seat, Seat.id == Incident.seat_id)
        columns.extend([Seat.id.label("seat_id"), Seat.label.label("seat_label")])
    statement = statement.add_columns(
        *columns,
        func.count().label("incident_count"),
        func.count().filter(ACTIVE).label("active_count"),
    ).where(visibility(user, scope))
    records = await session.execute(
        statement.group_by(*columns)
        .having(func.count() >= 2)
        .order_by(func.count().desc(), *columns)
    )
    rows = []
    for row in records.mappings():
        rows.append(
            {
                "id": f"{level}:{row[f'{level}_id']}:{row['category'].value}",
                "building_name": row["building_name"],
                "floor_label": row.get("floor_label"),
                "seat_label": row.get("seat_label"),
                "category": row["category"],
                "incident_count": row["incident_count"],
                "active_count": row["active_count"],
            }
        )
    return {"level": level, "rows": rows}


async def categories(session: AsyncSession, user: User, scope: ReportScope) -> dict:
    records = (
        await session.execute(
            select(Incident.category, func.count(), func.count().filter(ACTIVE))
            .where(visibility(user, scope))
            .group_by(Incident.category)
        )
    ).all()
    counts = {category: (total, active) for category, total, active in records}
    total = sum(value[0] for value in counts.values())
    rows = [
        {
            "id": category.value,
            "category": category,
            "incident_count": counts.get(category, (0, 0))[0],
            "active_count": counts.get(category, (0, 0))[1],
            "percentage": round(counts.get(category, (0, 0))[0] * 100 / total, 2)
            if total
            else 0,
        }
        for category in IncidentCategory
    ]
    return {"rows": sorted(rows, key=lambda row: (-row["incident_count"], row["id"]))}


async def timings(session: AsyncSession, user: User, query: ReportQuery) -> dict:
    conditions = criteria(user, query)
    aggregate = (
        (
            await session.execute(
                select(
                    *[
                        expression
                        for name, duration in DURATIONS.items()
                        for expression in (
                            func.count(duration).label(f"{name}_count"),
                            func.avg(duration).label(name),
                        )
                    ]
                ).where(*conditions)
            )
        )
        .mappings()
        .one()
    )
    rows = await page(
        session,
        tickets(*[value.label(name) for name, value in DURATIONS.items()]).where(
            *conditions
        ),
        query,
        DURATIONS,
    )
    return {
        **rows,
        "milestones": [
            {
                "id": name.removesuffix("_minutes"),
                "label": label,
                "sample_count": aggregate[f"{name}_count"],
                "average_minutes": aggregate[name],
            }
            for name, label in (
                ("assigned_minutes", "First assignment"),
                ("acknowledged_minutes", "Acknowledgment"),
                ("resolved_minutes", "Resolution"),
            )
        ],
    }


async def workload(session: AsyncSession) -> dict:
    active_count = func.count(Incident.id).filter(ACTIVE)
    statement = (
        select(
            EngineerProfile.user_id.label("id"),
            User.name,
            EngineerProfile.is_available,
            func.count(Incident.id).label("total_count"),
            active_count.label("active_count"),
            func.count(Incident.id)
            .filter(Incident.status == IncidentStatus.OPEN)
            .label("open_count"),
            func.count(Incident.id)
            .filter(Incident.status == IncidentStatus.IN_PROGRESS)
            .label("in_progress_count"),
            func.count(Incident.id)
            .filter(Incident.status == IncidentStatus.BLOCKED)
            .label("blocked_count"),
            func.count(Incident.id)
            .filter(ACTIVE, Incident.priority == IncidentPriority.HIGH)
            .label("high_priority_count"),
        )
        .select_from(EngineerProfile)
        .join(User, User.id == EngineerProfile.user_id)
    )
    statement = statement.outerjoin(
        Incident, Incident.assignee_id == EngineerProfile.user_id
    )
    rows = (
        (
            await session.execute(
                statement.group_by(EngineerProfile.user_id, User.name).order_by(
                    active_count.desc(), User.name, EngineerProfile.user_id
                )
            )
        )
        .mappings()
        .all()
    )
    unassigned = await session.scalar(
        select(func.count())
        .select_from(Incident)
        .where(ACTIVE, Incident.assignee_id.is_(None))
    )
    return {"rows": [dict(row) for row in rows], "unassigned_count": unassigned or 0}

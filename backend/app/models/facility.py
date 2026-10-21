"""Buildings, floors, and seats with parent-scoped labels."""

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Identity, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .incident import Incident


class Building(Base):
    """Top-level incident location."""

    __tablename__ = "buildings"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),)

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))

    floors: Mapped[list["Floor"]] = relationship(
        back_populates="building",
        passive_deletes="all",
    )
    incidents: Mapped[list["Incident"]] = relationship(
        back_populates="building",
        passive_deletes="all",
    )


class Floor(Base):
    """A labeled floor within one building."""

    __tablename__ = "floors"
    __table_args__ = (
        UniqueConstraint("building_id", "label", name="uq_floors_building_label"),
        UniqueConstraint("id", "building_id", name="uq_floors_id_building"),
        CheckConstraint("length(trim(label)) > 0", name="label_not_blank"),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="RESTRICT"),
        index=True,
    )
    label: Mapped[str] = mapped_column(String(50))

    building: Mapped[Building] = relationship(back_populates="floors")
    seats: Mapped[list["Seat"]] = relationship(
        back_populates="floor",
        passive_deletes="all",
    )


class Seat(Base):
    """A labeled seat within one floor."""

    __tablename__ = "seats"
    __table_args__ = (
        UniqueConstraint("floor_id", "label", name="uq_seats_floor_label"),
        UniqueConstraint("id", "floor_id", name="uq_seats_id_floor"),
        CheckConstraint("length(trim(label)) > 0", name="label_not_blank"),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    floor_id: Mapped[int] = mapped_column(
        ForeignKey("floors.id", ondelete="RESTRICT"),
        index=True,
    )
    label: Mapped[str] = mapped_column(String(50))

    floor: Mapped[Floor] = relationship(back_populates="seats")

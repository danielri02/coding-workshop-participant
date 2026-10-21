"""Facility CRUD payloads; parent identity remains fixed during label edits."""

from .base import Label, Name, PatchSchema, PositiveID, Schema


class BuildingCreate(Schema):
    """Create a building with a human-readable name."""

    name: Name


class BuildingUpdate(PatchSchema):
    """Rename an existing building."""

    name: Name | None = None


class BuildingRead(BuildingCreate):
    """A persisted building."""

    id: PositiveID


class FloorCreate(Schema):
    """Create a floor; label uniqueness is scoped to its building."""

    building_id: PositiveID
    label: Label


class FloorUpdate(PatchSchema):
    """Relabel a floor without relocating existing incidents or seats."""

    label: Label | None = None


class FloorRead(FloorCreate):
    """A persisted floor with its parent building ID."""

    id: PositiveID


class SeatCreate(Schema):
    """Create a seat; label uniqueness is scoped to its floor."""

    floor_id: PositiveID
    label: Label


class SeatUpdate(PatchSchema):
    """Relabel a seat without moving it to a different floor."""

    label: Label | None = None


class SeatRead(SeatCreate):
    """A persisted seat with its parent floor ID."""

    id: PositiveID

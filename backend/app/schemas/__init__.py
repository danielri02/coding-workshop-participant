"""Validated request and response types for the incident management API."""

from .auth import LoginRequest, RefreshRequest, TokenPair
from .facility import (
    BuildingCreate,
    BuildingRead,
    BuildingUpdate,
    FloorCreate,
    FloorRead,
    FloorUpdate,
    SeatCreate,
    SeatRead,
    SeatUpdate,
)
from .incident import (
    IncidentAdminUpdate,
    IncidentAssignment,
    IncidentCreate,
    IncidentPriorityUpdate,
    IncidentRead,
    IncidentStatusUpdate,
)
from .note import NoteCreate, NoteRead, NoteUpdate
from .user import (
    EngineerProfileCreate,
    EngineerProfileRead,
    EngineerProfileUpdate,
    UserAdminUpdate,
    UserCreate,
    UserRead,
    UserUpdate,
)

__all__ = [
    "LoginRequest",
    "RefreshRequest",
    "TokenPair",
    "BuildingCreate",
    "BuildingRead",
    "BuildingUpdate",
    "FloorCreate",
    "FloorRead",
    "FloorUpdate",
    "SeatCreate",
    "SeatRead",
    "SeatUpdate",
    "IncidentAdminUpdate",
    "IncidentAssignment",
    "IncidentCreate",
    "IncidentPriorityUpdate",
    "IncidentRead",
    "IncidentStatusUpdate",
    "NoteCreate",
    "NoteRead",
    "NoteUpdate",
    "EngineerProfileCreate",
    "EngineerProfileRead",
    "EngineerProfileUpdate",
    "UserAdminUpdate",
    "UserCreate",
    "UserRead",
    "UserUpdate",
]

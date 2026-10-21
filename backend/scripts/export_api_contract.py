"""Export OpenAPI and workflow metadata for generated frontend contracts.

Run through frontend's `npm run generate:api` using an installed backend Python
interpreter (set PYTHON if needed). No database connection is opened.
"""

import json
import sys
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.deployment import API_PREFIX, SERVICE_NAME
from backend.app.domain.incidents import ACTIVE_STATUSES, TRANSITIONS
from backend.app.main import app


def main() -> None:
    """Write a deterministic contract to stdout without environment values."""

    document = app.openapi()
    document["x-workshop-service"] = {"name": SERVICE_NAME, "prefix": API_PREFIX}
    document["x-incident-workflow"] = {
        "transitions": {
            current.value: [following.value for following in permitted]
            for current, permitted in TRANSITIONS.items()
        },
        "activeStatuses": [
            state.value for state in TRANSITIONS if state in ACTIVE_STATUSES
        ],
    }
    print(json.dumps(document, sort_keys=True))


if __name__ == "__main__":
    main()

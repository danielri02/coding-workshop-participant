"""Sanitized JSON responses and correlation IDs for unexpected HTTP failures."""

import logging
from uuid import uuid4

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


class ErrorResponseMiddleware:
    """Catch failures inside CORS, after request dependencies have rolled back."""

    def __init__(self, app: ASGIApp) -> None:
        """Wrap the application without buffering requests or responses."""

        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Return a safe error without logging SQL, credentials or input values."""

        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def track_response(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, track_response)
        except Exception as exc:  # noqa: BLE001 - Sanitize the HTTP error boundary.
            request_id = uuid4().hex
            logger.error(
                "Request failed request_id=%s exception_type=%s",
                request_id,
                type(exc).__name__,
            )
            if started:
                # A streamed response cannot be replaced once its headers are sent.
                raise RuntimeError(
                    f"Response failed; request_id={request_id}"
                ) from None
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": "The server could not complete this request. Please try again.",
                    "request_id": request_id,
                },
                headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
            )
            await response(scope, receive, send)

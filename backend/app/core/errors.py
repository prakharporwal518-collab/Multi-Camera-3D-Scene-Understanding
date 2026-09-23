"""Application errors that map to structured JSON responses.

Every error carries a stable machine-readable ``code``, a human-readable ``message``
and, where it helps, a ``hint`` that tells the user what to do next.
"""

from typing import Any


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(
        self,
        message: str,
        *,
        hint: str | None = None,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.details = details or {}
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.hint:
            body["hint"] = self.hint
        if self.details:
            body["details"] = self.details
        return {"error": body}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_failed"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class PayloadTooLarge(AppError):
    status_code = 413
    code = "payload_too_large"


class UnsupportedMedia(AppError):
    status_code = 415
    code = "unsupported_media_type"


class ProcessingError(AppError):
    """A pipeline stage could not produce a result from the given data."""

    status_code = 422
    code = "processing_failed"


class ServiceUnavailable(AppError):
    status_code = 503
    code = "service_unavailable"

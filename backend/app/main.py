import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api.routes import cameras, health, matching, projects, scene
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.database.session import init_db
from app.services.run_manager import RunManager

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    manager = RunManager(settings.worker_threads)
    manager.recover_interrupted()
    app.state.run_manager = manager
    yield
    manager.shutdown()


def _validation_message(exc: RequestValidationError) -> tuple[str, list[dict]]:
    fields = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"] if p not in ("body", "query", "path"))
        msg = err["msg"].removeprefix("Value error, ")
        fields.append({"field": loc, "message": msg})
    first = fields[0] if fields else {"field": "", "message": "Invalid request."}
    summary = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
    return summary, fields


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    app = FastAPI(
        title="Multi-Camera 3D Scene Understanding API",
        version=__version__,
        lifespan=lifespan,
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
        expose_headers=["Content-Disposition"],
    )

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(exc.to_dict(), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        summary, fields = _validation_message(exc)
        body = {"error": {"code": "validation_failed", "message": summary, "details": {"fields": fields}}}
        return JSONResponse(body, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse({"error": {"code": code, "message": str(exc.detail)}}, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        body = {"error": {"code": "internal_error", "message": "The server hit an unexpected error.",
                          "hint": "Try again. If it keeps happening, check the server log."}}
        return JSONResponse(body, status_code=500)

    for router in (health.router, projects.router, cameras.router, matching.router, scene.router):
        app.include_router(router, prefix=settings.api_prefix)
    return app


app = create_app()

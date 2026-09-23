from fastapi import Request

from app.services.run_manager import RunManager


def get_run_manager(request: Request) -> RunManager:
    return request.app.state.run_manager

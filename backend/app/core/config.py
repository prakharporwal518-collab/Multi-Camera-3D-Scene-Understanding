from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden with an env var of the same name."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./data/mc3d.db"
    storage_dir: Path = Path("./data/storage")

    # Comma separated list, e.g. "https://mc3d.vercel.app,http://localhost:5173"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_image_mb: float = Field(default=25, gt=0)
    max_video_mb: float = Field(default=250, gt=0)
    max_cameras: int = Field(default=8, ge=2, le=16)
    max_frames_per_camera: int = Field(default=300, ge=1)
    max_image_dimension: int = Field(default=4096, ge=256)

    processing_max_dimension: int = Field(default=1280, ge=320)
    processing_timeout_s: int = Field(default=600, ge=10)
    worker_threads: int = Field(default=2, ge=1, le=8)

    # Optional YOLOv8-style ONNX detector. Detection is skipped (not simulated) when unset.
    detector_model_path: Path | None = None
    detector_labels_path: Path | None = None
    detector_input_size: int = 640

    @field_validator("detector_model_path", "detector_labels_path", mode="before")
    @classmethod
    def _empty_path_is_none(cls, value: object) -> object:
        return None if value in ("", None) else value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

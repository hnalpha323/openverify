"""Service configuration, read from ``OPENVERIFY_VISION_*`` environment variables."""

from __future__ import annotations

from pathlib import Path
from typing import Final, cast

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.requests import Request

from openverify_vision.quality import (
    DEFAULT_BLUR_MIN,
    DEFAULT_BRIGHTNESS_MAX,
    DEFAULT_BRIGHTNESS_MIN,
    DEFAULT_GLARE_MAX,
    QualityThresholds,
)

MIN_SERVICE_TOKEN_LENGTH: Final = 32
SECRET_VARIABLES: Final = ("OPENVERIFY_VISION_SERVICE_TOKEN",)
"""The secrets the service reads, each also from ``<NAME>_FILE`` (C249.2; Workflow 11C)."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPENVERIFY_VISION_", extra="ignore", frozen=True)

    service_token: SecretStr
    """Shared secret that callers must send in the ``x-service-token`` header."""

    max_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=40_000_000, gt=0)
    models_dir: Path = Path("models")
    models_manifest: Path | None = None
    """``models/manifest.json``: when set (the image sets it), a model whose SHA-256 differs from
    its pin stops the start (C257.1; Phase 11, Workflow 11C)."""
    blur_threshold: float = Field(default=DEFAULT_BLUR_MIN, ge=0.0)
    glare_threshold: float = Field(default=DEFAULT_GLARE_MAX, ge=0.0, le=1.0)
    brightness_min: float = Field(default=DEFAULT_BRIGHTNESS_MIN, ge=0.0, le=1.0)
    brightness_max: float = Field(default=DEFAULT_BRIGHTNESS_MAX, ge=0.0, le=1.0)
    face_score_threshold: float = Field(default=0.9, gt=0.0, lt=1.0)
    """Minimum YuNet confidence for a detection to count as a face."""
    max_concurrent_jobs: int = Field(default=2, gt=0)
    """Requests whose uploads are decoded and analysed at once. A decoded image can take
    hundreds of megabytes, and the model locks serialise inference anyway."""
    max_queued_jobs: int = Field(default=8, ge=0)
    """Requests that wait for a free job slot. Requests beyond them get 503 with Retry-After."""

    @field_validator("service_token")
    @classmethod
    def _token_is_long_enough(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < MIN_SERVICE_TOKEN_LENGTH:
            raise ValueError(f"must be at least {MIN_SERVICE_TOKEN_LENGTH} characters")
        return value

    @model_validator(mode="after")
    def _brightness_range(self) -> Settings:
        if self.brightness_min > self.brightness_max:
            raise ValueError("brightness_min must not exceed brightness_max")
        return self

    @property
    def quality_thresholds(self) -> QualityThresholds:
        return QualityThresholds(
            blur_min=self.blur_threshold,
            glare_max=self.glare_threshold,
            brightness_min=self.brightness_min,
            brightness_max=self.brightness_max,
        )


def get_settings(request: Request) -> Settings:
    """FastAPI dependency returning the settings the app was created with."""
    return cast("Settings", request.app.state.settings)

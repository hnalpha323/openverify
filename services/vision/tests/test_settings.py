"""Service configuration loaded from OPENVERIFY_VISION_* environment variables."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from openverify_vision.settings import Settings

TOKEN = "t" * 32


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "SERVICE_TOKEN",
        "MAX_UPLOAD_BYTES",
        "MAX_IMAGE_PIXELS",
        "MODELS_DIR",
        "BLUR_THRESHOLD",
        "GLARE_THRESHOLD",
        "BRIGHTNESS_MIN",
        "BRIGHTNESS_MAX",
        "FACE_SCORE_THRESHOLD",
        "MAX_CONCURRENT_JOBS",
        "MAX_QUEUED_JOBS",
    ):
        monkeypatch.delenv(f"OPENVERIFY_VISION_{name}", raising=False)


def test_reads_prefixed_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENVERIFY_VISION_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("OPENVERIFY_VISION_MAX_UPLOAD_BYTES", "2048")
    monkeypatch.setenv("OPENVERIFY_VISION_MAX_IMAGE_PIXELS", "4096")
    monkeypatch.setenv("OPENVERIFY_VISION_MODELS_DIR", "/models")
    monkeypatch.setenv("OPENVERIFY_VISION_BLUR_THRESHOLD", "55.5")
    monkeypatch.setenv("OPENVERIFY_VISION_GLARE_THRESHOLD", "0.2")

    settings = Settings()

    assert settings.service_token.get_secret_value() == TOKEN
    assert settings.max_upload_bytes == 2048
    assert settings.max_image_pixels == 4096
    assert settings.models_dir == Path("/models")
    assert settings.blur_threshold == 55.5
    assert settings.glare_threshold == 0.2


def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENVERIFY_VISION_SERVICE_TOKEN", TOKEN)

    settings = Settings()

    assert settings.max_upload_bytes == 10 * 1024 * 1024
    assert settings.max_image_pixels == 40_000_000
    assert settings.models_dir == Path("models")
    assert settings.blur_threshold == 100.0
    assert settings.glare_threshold == 0.05
    assert settings.brightness_min == 0.15
    assert settings.brightness_max == 0.9
    assert settings.face_score_threshold == 0.9
    assert settings.max_concurrent_jobs == 2
    assert settings.max_queued_jobs == 8


def test_service_token_is_required() -> None:
    with pytest.raises(ValidationError, match="service_token"):
        Settings()


def test_short_service_token_is_rejected() -> None:
    with pytest.raises(ValidationError, match="service_token"):
        Settings(service_token="too-short")


def test_service_token_is_not_exposed_in_repr() -> None:
    settings = Settings(service_token=TOKEN)

    assert TOKEN not in repr(settings)
    assert TOKEN not in str(settings.model_dump())


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("max_upload_bytes", 0),
        ("max_image_pixels", 0),
        ("blur_threshold", -1.0),
        ("glare_threshold", 1.5),
        ("brightness_min", -0.1),
        ("brightness_max", 1.1),
        ("face_score_threshold", 0.0),
        ("face_score_threshold", 1.0),
        ("max_concurrent_jobs", 0),
        ("max_queued_jobs", -1),
    ],
)
def test_limits_and_thresholds_are_validated(field: str, value: float) -> None:
    with pytest.raises(ValidationError, match=field):
        Settings.model_validate({"service_token": TOKEN, field: value})


def test_reads_face_and_exposure_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENVERIFY_VISION_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("OPENVERIFY_VISION_BRIGHTNESS_MIN", "0.2")
    monkeypatch.setenv("OPENVERIFY_VISION_BRIGHTNESS_MAX", "0.8")
    monkeypatch.setenv("OPENVERIFY_VISION_FACE_SCORE_THRESHOLD", "0.75")

    settings = Settings()

    assert (settings.brightness_min, settings.brightness_max) == (0.2, 0.8)
    assert settings.face_score_threshold == 0.75


def test_brightness_range_must_not_be_inverted() -> None:
    with pytest.raises(ValidationError, match="brightness_min"):
        Settings.model_validate(
            {"service_token": TOKEN, "brightness_min": 0.9, "brightness_max": 0.1}
        )


def test_quality_thresholds_come_from_settings() -> None:
    settings = Settings.model_validate(
        {
            "service_token": TOKEN,
            "blur_threshold": 50.0,
            "glare_threshold": 0.1,
            "brightness_min": 0.2,
            "brightness_max": 0.7,
        }
    )

    thresholds = settings.quality_thresholds

    assert thresholds.blur_min == 50.0
    assert thresholds.glare_max == 0.1
    assert (thresholds.brightness_min, thresholds.brightness_max) == (0.2, 0.7)


def test_reads_job_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENVERIFY_VISION_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("OPENVERIFY_VISION_MAX_CONCURRENT_JOBS", "3")
    monkeypatch.setenv("OPENVERIFY_VISION_MAX_QUEUED_JOBS", "0")

    settings = Settings()

    assert (settings.max_concurrent_jobs, settings.max_queued_jobs) == (3, 0)

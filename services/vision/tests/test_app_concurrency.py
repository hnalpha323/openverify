"""Bounded image work: decoding and analysis run at most ``max_concurrent_jobs`` at a time.

Every decoded upload can hold hundreds of megabytes, so requests beyond the running jobs wait
in a bounded queue, and requests beyond the queue are refused with 503 and ``Retry-After``.
"""

from __future__ import annotations

import gc
import threading
import time
import weakref
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Final

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.faces import Face
from openverify_vision.imaging import decode_image
from openverify_vision.settings import Settings
from test_app_analyze import (
    AUTH,
    ONE_FACE,
    TOKEN,
    CountingRecognizer,
    NormalisedFakeDetector,
    assert_problem,
)

from synthetic import Image, encode, make_checkerboard, make_noise

WAIT_SECONDS: Final = 5.0
"""Upper bound on every wait in these tests, so a regression fails instead of hanging."""

DETECT_HOLD_SECONDS: Final = 2.0
"""How long the first detection holds its job at most, waiting to be released."""

QUEUE_SETTLE_SECONDS: Final = 0.3
"""Time for a queued request to reach the limiter before the running job is released."""


class GateDetector:
    """Holds detections until :attr:`release` is set and records how many ran at once."""

    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()
        self._lock = threading.Lock()
        self._active = 0
        self.max_active = 0

    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        with self._lock:
            self._active += 1
            self.max_active = max(self.max_active, self._active)
        self.entered.set()
        self.release.wait(timeout=DETECT_HOLD_SECONDS)
        with self._lock:
            self._active -= 1
        return []


def make_client(detector: GateDetector, **overrides: object) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, **overrides})
    engine = FaceEngine(detector, CountingRecognizer())
    return TestClient(create_app(settings, face_engine=engine), raise_server_exceptions=False)


def png() -> tuple[str, bytes, str]:
    return ("image.png", encode(make_checkerboard(), "PNG"), "image/png")


def embed(client: TestClient) -> Response:
    return client.post("/v1/embed/face", files={"image": png()}, headers=AUTH)


@pytest.mark.parametrize(
    ("path", "field"),
    [
        ("/v1/quality", "image"),
        ("/v1/embed/face", "image"),
        ("/v1/analyze/government-id", "front"),
        ("/v1/analyze/selfie", "center"),
    ],
)
def test_work_beyond_the_running_and_queued_jobs_is_503_with_retry_after(
    path: str, field: str
) -> None:
    detector = GateDetector()
    with (
        make_client(detector, max_concurrent_jobs=1, max_queued_jobs=0) as client,
        ThreadPoolExecutor(max_workers=1) as pool,
    ):
        running = pool.submit(embed, client)
        assert detector.entered.wait(WAIT_SECONDS)

        refused = client.post(path, files={field: png()}, headers=AUTH)
        detector.release.set()

        assert running.result(timeout=WAIT_SECONDS).status_code == 200

    body = assert_problem(refused, 503)
    assert "busy" in body["detail"]
    assert int(refused.headers["retry-after"]) > 0


def test_queued_work_waits_for_a_free_slot_instead_of_running_alongside() -> None:
    detector = GateDetector()
    with (
        make_client(detector, max_concurrent_jobs=1, max_queued_jobs=1) as client,
        ThreadPoolExecutor(max_workers=2) as pool,
    ):
        first = pool.submit(embed, client)
        assert detector.entered.wait(WAIT_SECONDS)
        second = pool.submit(embed, client)
        time.sleep(QUEUE_SETTLE_SECONDS)
        detector.release.set()

        statuses = [first.result(WAIT_SECONDS).status_code, second.result(WAIT_SECONDS).status_code]

    assert statuses == [200, 200]
    assert detector.max_active == 1


def test_a_freed_slot_is_reused() -> None:
    detector = GateDetector()
    detector.release.set()
    with make_client(detector, max_concurrent_jobs=1, max_queued_jobs=0) as client:
        statuses = [embed(client).status_code for _ in range(3)]

    assert statuses == [200, 200, 200]


def test_health_is_never_limited() -> None:
    detector = GateDetector()
    with (
        make_client(detector, max_concurrent_jobs=1, max_queued_jobs=0) as client,
        ThreadPoolExecutor(max_workers=1) as pool,
    ):
        running = pool.submit(embed, client)
        assert detector.entered.wait(WAIT_SECONDS)

        health = client.get("/health")
        detector.release.set()
        running.result(timeout=WAIT_SECONDS)

    assert health.status_code == 200


# --- one full-size decode at a time (Workflow 4B review H008) ----------------------------------


def count_live_decodes(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Spy on the app's decoder: before each decode, how many earlier decodes are still alive."""
    alive: list[weakref.ref[Image]] = []
    counts: list[int] = []

    def tracking(data: bytes, *, max_pixels: int) -> Image:
        gc.collect()
        counts.append(sum(ref() is not None for ref in alive))
        image = decode_image(data, max_pixels=max_pixels)
        alive.append(weakref.ref(image))
        return image

    monkeypatch.setattr("openverify_vision.app.decode_image", tracking)
    return counts


def noise_png(seed: int) -> tuple[str, bytes, str]:
    return ("pose.png", encode(make_noise(height=96, width=128, seed=seed), "PNG"), "image/png")


@pytest.mark.parametrize("faces", [ONE_FACE, []], ids=["centre-face", "no-face"])
def test_a_selfie_job_holds_one_full_size_decode_at_a_time(
    monkeypatch: pytest.MonkeyPatch, faces: list[tuple[float, float, float, float]]
) -> None:
    """H008 (Workflow 4B review): the three poses were decoded together and held to the end of the
    job, about 350 MB for three 39-megapixel poses before any analysis. Each pose is decoded,
    analysed and reduced to its answer (the centre also to the small crop its consistency needs)
    before the next one is decoded."""
    counts = count_live_decodes(monkeypatch)
    settings = Settings.model_validate({"service_token": TOKEN})
    engine = FaceEngine(NormalisedFakeDetector(faces), CountingRecognizer())
    client = TestClient(create_app(settings, face_engine=engine), raise_server_exceptions=False)

    response = client.post(
        "/v1/analyze/selfie",
        files={"center": noise_png(1), "left": noise_png(2), "right": noise_png(3)},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    assert [entry["pose"] for entry in response.json()["consistency"]] == ["left", "right"]
    assert counts == [0, 0, 0]


def test_a_bad_side_pose_still_wins_over_missing_models(tmp_path: Path) -> None:
    """H008: client errors win over a 503, whatever order the poses are decoded and analysed in."""
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(tmp_path)})
    client = TestClient(create_app(settings), raise_server_exceptions=False)

    response = client.post(
        "/v1/analyze/selfie",
        files={"center": noise_png(1), "right": ("r.png", b"not an image", "image/png")},
        headers=AUTH,
    )

    body = assert_problem(response, 415)
    assert body["detail"].startswith("right: ")

"""``forensics/geometry.py``: coordinates between the upload and the rectified document."""

from __future__ import annotations

import numpy as np
import pytest

from forensic_scenes import full_frame, not_found
from openverify_vision.forensics.geometry import (
    document_mask,
    fit_within,
    map_box,
    map_points,
    mask_bounds,
    rectified_to_upload,
    upload_to_rectified,
)
from openverify_vision.schemas import DocumentDetection

QUAD = ((100.0, 50.0), (500.0, 80.0), (480.0, 330.0), (90.0, 300.0))


def found(quad: tuple[tuple[float, float], ...] = QUAD) -> DocumentDetection:
    return DocumentDetection.model_validate(
        {
            "found": True,
            "quad": quad,
            "method": "contour",
            "rectified_size": (400, 252),
            "aspect_ratio": 1.587,
            "area_ratio": 0.5,
        }
    )


def test_the_rectified_corners_map_onto_the_quad() -> None:
    homography = rectified_to_upload(found())
    assert homography is not None

    mapped = map_points(homography, [(0.0, 0.0), (400.0, 0.0), (400.0, 252.0), (0.0, 252.0)])

    assert mapped is not None
    assert np.allclose(mapped, QUAD, atol=1e-6)


def test_no_document_or_a_degenerate_quad_has_no_mapping() -> None:
    point = (5.0, 5.0)

    assert rectified_to_upload(not_found().detection) is None
    assert rectified_to_upload(found((point, point, point, point))) is None
    assert rectified_to_upload(found(((0, 0), (10, 10), (20, 20), (30, 30)))) is None


def test_a_point_sent_to_infinity_is_not_mapped() -> None:
    horizon = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])

    assert map_points(horizon, [(0.0, 3.0)]) is None
    assert map_points(horizon, []) == []


@pytest.mark.parametrize(
    ("shape", "expected"),
    [((100, 200, 3), (100, 200)), ((3000, 1000), (1024, 341)), ((500, 4000, 3), (128, 1024))],
)
def test_fit_within_downscales_only_larger_images(
    shape: tuple[int, ...], expected: tuple[int, int]
) -> None:
    image = np.zeros(shape, dtype=np.uint8)

    resized, scale = fit_within(image, 1024)

    assert resized.shape[:2] == expected
    assert scale == pytest.approx(min(1.0, 1024 / max(shape[:2])))
    assert resized.dtype == np.uint8


def test_a_full_frame_document_maps_the_identity() -> None:
    image = np.zeros((200, 300, 3), dtype=np.uint8)
    homography = rectified_to_upload(full_frame(image).detection)

    assert homography is not None
    assert np.allclose(homography / homography[2, 2], np.eye(3), atol=1e-9)


def test_upload_to_rectified_inverts_rectified_to_upload() -> None:
    forward = rectified_to_upload(found())
    backward = upload_to_rectified(found())
    assert forward is not None
    assert backward is not None

    mapped = map_points(backward, list(QUAD))

    assert mapped is not None
    assert np.allclose(mapped, [(0, 0), (400, 0), (400, 252), (0, 252)], atol=1e-6)
    assert upload_to_rectified(not_found().detection) is None


def test_a_box_maps_to_the_bounding_box_of_its_corners_clipped_to_the_bounds() -> None:
    scale = np.diag([2.0, 3.0, 1.0])

    assert map_box(scale, (10.0, 20.0, 5.0, 4.0), bounds=(1000, 1000)) == (20.0, 60.0, 10.0, 12.0)
    assert map_box(scale, (-10.0, -10.0, 15.0, 15.0), bounds=(1000, 1000)) == (0.0, 0.0, 10.0, 15.0)


@pytest.mark.parametrize(
    "box",
    [(600.0, 600.0, 10.0, 10.0), (10.0, 10.0, 0.2, 0.2), (-50.0, 5.0, 10.0, 10.0)],
    ids=["outside", "sub-pixel", "left-of-bounds"],
)
def test_a_box_with_less_than_a_pixel_inside_the_bounds_is_not_mapped(
    box: tuple[float, float, float, float],
) -> None:
    assert map_box(np.eye(3), box, bounds=(500, 400)) is None


def test_a_box_sent_to_infinity_is_not_mapped() -> None:
    horizon = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])

    assert map_box(horizon, (0.0, 0.0, 10.0, 10.0), bounds=(100, 100)) is None


def test_the_document_mask_is_the_quad_polygon() -> None:
    mask = document_mask(found(), (400, 600))

    assert mask.shape == (400, 600)
    assert mask[150, 300]
    assert not mask[10, 10]
    assert not mask[390, 590]
    assert mask_bounds(mask) == (90, 50, 501, 331)


def test_without_a_document_or_with_an_empty_quad_the_mask_is_the_whole_upload() -> None:
    point = (900.0, 900.0)

    assert document_mask(not_found().detection, (30, 40)).all()
    assert document_mask(found((point, point, point, point)), (30, 40)).all()

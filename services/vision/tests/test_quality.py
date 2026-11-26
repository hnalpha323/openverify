"""Image-quality metrics and the id_blur_detection / id_glare_detection checks."""

from __future__ import annotations

from collections.abc import Callable

import cv2
import numpy as np
import pytest

from openverify_vision.quality import (
    QualityThresholds,
    assess_quality,
    blur_score,
    brightness,
    glare_mask,
    glare_ratio,
    summarize_quality,
    tenengrad,
)

from synthetic import Image, gaussian_blur, make_checkerboard, make_uniform

# --- blur_score -----------------------------------------------------------------------------


def test_sharp_checkerboard_scores_higher_than_blurred(checkerboard: Image) -> None:
    sharp = blur_score(checkerboard)
    blurred = blur_score(gaussian_blur(checkerboard))

    assert sharp > blurred
    assert sharp > 10 * blurred  # the gap is large, not marginal


def test_blur_score_of_flat_image_is_zero() -> None:
    assert blur_score(make_uniform(128)) == 0.0


def test_blur_score_is_variance_of_laplacian(checkerboard: Image) -> None:
    gray = cv2.cvtColor(checkerboard, cv2.COLOR_BGR2GRAY)
    expected = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    assert blur_score(checkerboard) == pytest.approx(expected)


def test_blur_score_accepts_grayscale_and_matches_bgr(checkerboard: Image) -> None:
    gray = cv2.cvtColor(checkerboard, cv2.COLOR_BGR2GRAY)

    assert blur_score(gray) == pytest.approx(blur_score(checkerboard))


# --- glare_ratio ----------------------------------------------------------------------------


def _with_white_patch(base: Image, x: int, y: int, w: int, h: int) -> Image:
    image = base.copy()
    image[y : y + h, x : x + w] = 255
    return image


def test_glare_ratio_is_zero_without_highlights() -> None:
    assert glare_ratio(make_uniform(128)) == 0.0


def test_glare_ratio_measures_fraction_of_specular_pixels() -> None:
    # 160x120 mid-gray card with an 80x60 saturated white highlight = 25% of the pixels.
    image = _with_white_patch(make_uniform(128), x=0, y=0, w=80, h=60)

    assert glare_ratio(image) == pytest.approx(0.25)


def test_saturated_colour_is_not_glare() -> None:
    # Pure red has maximum value but maximum saturation: a printed colour, not a reflection.
    assert glare_ratio(make_uniform((0, 0, 255))) == 0.0


def test_bright_but_not_clipped_white_is_not_glare() -> None:
    # Well-exposed white card stock (~225) must not be mistaken for a specular highlight.
    assert glare_ratio(make_uniform(225)) == 0.0


def test_glare_ratio_is_restricted_to_roi() -> None:
    image = _with_white_patch(make_uniform(128), x=0, y=0, w=80, h=60)

    assert glare_ratio(image, roi=(0, 0, 80, 60)) == pytest.approx(1.0)
    assert glare_ratio(image, roi=(80, 60, 80, 60)) == 0.0
    assert glare_ratio(image, roi=(40, 0, 80, 60)) == pytest.approx(0.5)


@pytest.mark.parametrize(
    "roi",
    [
        (0, 0, 0, 10),  # empty width
        (0, 0, 10, 0),  # empty height
        (-1, 0, 10, 10),  # negative origin
        (150, 0, 20, 10),  # extends past the right edge (width is 160)
        (0, 115, 10, 10),  # extends past the bottom edge (height is 120)
    ],
)
def test_glare_ratio_rejects_invalid_roi(roi: tuple[int, int, int, int]) -> None:
    with pytest.raises(ValueError, match="roi"):
        glare_ratio(make_uniform(128), roi=roi)


def test_glare_ratio_accepts_grayscale() -> None:
    gray = np.full((10, 10), 255, dtype=np.uint8)

    assert glare_ratio(gray) == pytest.approx(1.0)


# --- glare_mask and tenengrad (C32.1, the rectified document) --------------------------------


def test_glare_mask_marks_exactly_the_pixels_glare_ratio_counts() -> None:
    image = _with_white_patch(make_uniform(128), x=10, y=20, w=30, h=40)
    image[0:5, 0:5] = (0, 0, 255)  # saturated colour: bright but not glare

    mask = glare_mask(image)

    assert mask.shape == image.shape[:2]
    assert mask.dtype == np.bool_
    assert int(mask.sum()) == 30 * 40
    assert bool(mask[20:60, 10:40].all())
    assert float(mask.mean()) == pytest.approx(glare_ratio(image))


def test_glare_mask_accepts_grayscale() -> None:
    gray = np.full((4, 6), 255, dtype=np.uint8)

    assert bool(glare_mask(gray).all())


def test_tenengrad_is_the_mean_squared_sobel_gradient(checkerboard: Image) -> None:
    gray = cv2.cvtColor(checkerboard, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)

    assert tenengrad(checkerboard) == pytest.approx(float(np.mean(gx * gx + gy * gy)))
    assert tenengrad(gray) == pytest.approx(tenengrad(checkerboard))


def test_tenengrad_of_a_flat_image_is_zero() -> None:
    assert tenengrad(make_uniform(200)) == 0.0


def test_tenengrad_falls_when_blurred(checkerboard: Image) -> None:
    assert tenengrad(gaussian_blur(checkerboard)) < tenengrad(checkerboard) / 5


@pytest.mark.parametrize("metric", [tenengrad, glare_mask])
def test_document_metrics_reject_non_images(metric: Callable[[Image], object]) -> None:
    with pytest.raises(ValueError, match="image"):
        metric(np.zeros((10, 10), dtype=np.float32))


# --- brightness -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, 0.0), (255, 1.0), (51, 0.2)],
)
def test_brightness_is_mean_intensity_normalised_to_unit_range(value: int, expected: float) -> None:
    assert brightness(make_uniform(value)) == pytest.approx(expected)


# --- input validation -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        np.zeros((0, 0, 3), dtype=np.uint8),  # empty
        np.zeros((10, 10, 3), dtype=np.float32),  # wrong dtype
        np.zeros((10, 10, 4), dtype=np.uint8),  # unsupported channel count
        np.zeros((10,), dtype=np.uint8),  # not an image
    ],
)
@pytest.mark.parametrize("metric", [blur_score, glare_ratio, brightness])
def test_metrics_reject_non_images(metric: Callable[[Image], float], bad: Image) -> None:
    with pytest.raises(ValueError, match="image"):
        metric(bad)


# --- assess_quality -------------------------------------------------------------------------


def test_sharp_clean_image_passes_both_checks(midtone_checkerboard: Image) -> None:
    thresholds = QualityThresholds(blur_min=100.0, glare_max=0.05)

    report = assess_quality(midtone_checkerboard, thresholds)

    blur = report.checks["id_blur_detection"]
    assert blur.status == "passed"
    assert blur.score == pytest.approx(blur_score(midtone_checkerboard))
    assert blur.threshold == 100.0

    glare = report.checks["id_glare_detection"]
    assert glare.status == "passed"
    assert glare.score == 0.0
    assert glare.threshold == 0.05


def test_blurred_image_fails_blur_check(checkerboard: Image) -> None:
    report = assess_quality(gaussian_blur(checkerboard), QualityThresholds(blur_min=100.0))

    assert report.checks["id_blur_detection"].status == "failed"


def test_glare_above_threshold_fails_glare_check() -> None:
    dark_board = make_checkerboard(low=0, high=127)
    image = _with_white_patch(dark_board, x=0, y=0, w=128, h=256)  # left half clipped: 50% glare

    report = assess_quality(image, QualityThresholds(glare_max=0.05))

    glare = report.checks["id_glare_detection"]
    assert glare.status == "failed"
    assert glare.score == pytest.approx(0.5)


def test_glare_below_threshold_passes_glare_check() -> None:
    image = make_checkerboard(low=0, high=127)  # dark-gray/black board, no highlights

    report = assess_quality(image, QualityThresholds(glare_max=0.05))

    assert report.checks["id_glare_detection"].status == "passed"
    assert report.checks["id_glare_detection"].score == 0.0


def test_scores_exactly_at_threshold_pass(checkerboard: Image) -> None:
    exact = QualityThresholds(
        blur_min=blur_score(checkerboard),
        glare_max=glare_ratio(checkerboard),
    )

    report = assess_quality(checkerboard, exact)

    assert report.checks["id_blur_detection"].status == "passed"
    assert report.checks["id_glare_detection"].status == "passed"


def test_report_includes_brightness_and_dimensions() -> None:
    image = make_uniform(51, height=30, width=40)

    report = assess_quality(image, QualityThresholds())

    assert report.metrics.brightness == pytest.approx(0.2)
    assert (report.metrics.width, report.metrics.height) == (40, 30)


def test_report_serialises_to_contract_shape(checkerboard: Image) -> None:
    payload = assess_quality(checkerboard, QualityThresholds()).model_dump(mode="json")

    assert set(payload) == {"checks", "metrics"}
    assert set(payload["checks"]) == {"id_blur_detection", "id_glare_detection"}
    for result in payload["checks"].values():
        assert set(result) == {"status", "score", "threshold"}
        assert result["status"] in {"passed", "failed"}
    assert set(payload["metrics"]) == {"brightness", "width", "height"}


def test_default_thresholds_are_documented_constants() -> None:
    defaults = QualityThresholds()

    assert defaults.blur_min == 100.0
    assert defaults.glare_max == 0.05


@pytest.mark.parametrize(
    "kwargs",
    [{"blur_min": -1.0}, {"glare_max": -0.1}, {"glare_max": 1.5}],
)
def test_thresholds_are_validated(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError, match=r"greater than or equal|less than or equal"):
        QualityThresholds(**kwargs)


# --- summarize_quality (C6 "quality" object) -------------------------------------------------


def test_summary_of_sharp_midtone_image_flags_nothing(midtone_checkerboard: Image) -> None:
    summary = summarize_quality(midtone_checkerboard, QualityThresholds())

    assert summary.blur_score == pytest.approx(blur_score(midtone_checkerboard))
    assert summary.is_blurry is False
    assert summary.glare_ratio == 0.0
    assert summary.has_glare is False
    assert summary.brightness == pytest.approx(brightness(midtone_checkerboard))
    assert summary.is_too_dark is False
    assert summary.is_too_bright is False


def test_summary_flags_blur(midtone_checkerboard: Image) -> None:
    summary = summarize_quality(gaussian_blur(midtone_checkerboard), QualityThresholds())

    assert summary.is_blurry is True


def test_summary_flags_glare() -> None:
    image = _with_white_patch(make_checkerboard(low=0, high=127), x=0, y=0, w=128, h=256)

    summary = summarize_quality(image, QualityThresholds(glare_max=0.05))

    assert summary.has_glare is True
    assert summary.glare_ratio == pytest.approx(0.5)


@pytest.mark.parametrize(
    ("value", "too_dark", "too_bright"),
    [(10, True, False), (128, False, False), (245, False, True)],
)
def test_summary_flags_exposure(value: int, too_dark: bool, too_bright: bool) -> None:
    thresholds = QualityThresholds(brightness_min=0.15, brightness_max=0.9)

    summary = summarize_quality(make_uniform(value), thresholds)

    assert summary.is_too_dark is too_dark
    assert summary.is_too_bright is too_bright


def test_summary_values_exactly_at_thresholds_are_acceptable(checkerboard: Image) -> None:
    exact = QualityThresholds(
        blur_min=blur_score(checkerboard),
        glare_max=glare_ratio(checkerboard),
        brightness_min=brightness(checkerboard),
        brightness_max=brightness(checkerboard),
    )

    summary = summarize_quality(checkerboard, exact)

    assert summary.is_blurry is False
    assert summary.has_glare is False
    assert summary.is_too_dark is False
    assert summary.is_too_bright is False


def test_default_brightness_thresholds() -> None:
    defaults = QualityThresholds()

    assert defaults.brightness_min == 0.15
    assert defaults.brightness_max == 0.9


@pytest.mark.parametrize(
    "kwargs",
    [
        {"brightness_min": -0.1},
        {"brightness_max": 1.5},
        {"brightness_min": 0.8, "brightness_max": 0.2},
    ],
)
def test_brightness_thresholds_are_validated(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError, match="brightness"):
        QualityThresholds(**kwargs)

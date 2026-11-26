"""tools/selfie_spoofs.py: C45.2 presentation-attack simulations (research §10.3).

Pipeline fixtures, not attack-detection rates: these check that each recipe does what it says
(moiré from a subpixel screen, a dark bezel and a backlit screen, a print's paper and halftone),
seeded and deterministic, on synthetic pictures only.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from selfie_fakes import textured
from selfie_spoofs import RECIPES, SPOOFS, phone_composite, print_halftone, screen_replay

FLAT = np.full((480, 640, 3), 128, dtype=np.uint8)


def high_band_peak_ratio(image: np.ndarray) -> float:
    """Peak over median of the spectrum above 0.25 cycles per pixel: periodic structure."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float64)
    spectrum = np.abs(np.fft.fftshift(np.fft.fft2(gray - gray.mean())))
    height, width = gray.shape
    yy, xx = np.mgrid[0:height, 0:width]
    band = spectrum[np.hypot((yy - height / 2) / height, (xx - width / 2) / width) > 0.25]
    return float(band.max() / np.median(band))


def dark_fraction(image: np.ndarray, level: int = 35) -> float:
    return float(np.all(image < level, axis=2).mean())


@pytest.mark.parametrize("kind", sorted(SPOOFS))
def test_every_spoof_is_seeded_deterministic_and_frame_sized(kind: str) -> None:
    spoof = SPOOFS[kind]
    picture = textured()

    first, again, other = spoof(picture, 7), spoof(picture, 7), spoof(picture, 8)

    assert first.shape == picture.shape
    assert first.dtype == np.uint8
    assert np.array_equal(first, again)
    assert not np.array_equal(first, other)
    assert not np.array_equal(first, picture)
    assert RECIPES[kind]


def test_the_spoof_kinds_are_the_plans() -> None:
    assert set(SPOOFS) == {"screen_replay", "phone_bezel", "phone_full_frame", "print_halftone"}


def test_a_screen_replay_adds_moire_and_keeps_the_brightness() -> None:
    replay = screen_replay(FLAT, 1)
    noise = np.random.default_rng(1).normal(0, 2, FLAT.shape)
    reference = np.clip(FLAT + noise, 0, 255).astype(np.uint8)

    # The subpixel mosaic aliases into a periodic pattern a flat, noisy picture does not have.
    assert high_band_peak_ratio(replay) > 1.4 * high_band_peak_ratio(reference)
    assert replay.mean() == pytest.approx(FLAT.mean(), rel=0.1)


def test_a_phone_composite_shows_a_dark_bezel_around_a_backlit_screen() -> None:
    phone = phone_composite(FLAT, 2, bezel=True)

    assert 0.01 < dark_fraction(phone) < 0.15


def test_a_full_frame_phone_has_no_bezel_but_a_raised_black_level_and_glare() -> None:
    black = np.zeros_like(FLAT)

    flat = phone_composite(FLAT, 3, bezel=False)
    dark = phone_composite(black, 3, bezel=False)

    assert dark_fraction(flat) < 0.001
    assert np.percentile(dark, 1) >= 8  # backlight bleed: a screen never shows true black
    assert flat.max() - np.median(flat) >= 40  # the specular glare


def test_a_print_is_paper_toned_desaturated_and_halftoned() -> None:
    saturated = np.zeros_like(FLAT)
    saturated[:, :320] = (30, 30, 230)
    saturated[:, 320:] = (230, 60, 30)

    printed = print_halftone(saturated, 4)
    white = print_halftone(np.full_like(FLAT, 255), 4)
    grey = print_halftone(FLAT, 4)

    def saturation(image: np.ndarray) -> float:
        return float(cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[..., 1].mean())

    assert saturation(printed) < saturation(saturated)
    assert np.percentile(white, 99) < 250  # paper is never pure white
    assert np.percentile(printed, 0.5) > 5  # nor ink pure black
    assert cv2.Laplacian(cv2.cvtColor(grey, cv2.COLOR_BGR2GRAY), cv2.CV_64F).std() > 3

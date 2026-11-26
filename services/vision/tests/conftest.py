"""Shared fixtures. Test images are synthetic (see ``synthetic.py``); no real photos are used."""

from __future__ import annotations

import pytest

from synthetic import Image, make_checkerboard


@pytest.fixture
def checkerboard() -> Image:
    """Sharp black/white checkerboard: half of its pixels are clipped white."""
    return make_checkerboard()


@pytest.fixture
def midtone_checkerboard() -> Image:
    """Sharp checkerboard with no clipped highlights (40/200 intensities)."""
    return make_checkerboard(low=40, high=200)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"

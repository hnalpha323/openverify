"""The seed record (C268.3): read from a 0600 file only, its pools and references named."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scenarios.seed import Seed, SeedError
from tests.fixtures import record


def write(tmp_path: Path, data: object, mode: int = 0o600) -> Path:
    path = tmp_path / "seed.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    path.chmod(mode)
    return path


def test_a_0600_record_loads(tmp_path: Path) -> None:
    seed = Seed.load(write(tmp_path, record()))
    assert seed.scale == "small"
    assert len(seed.pool("api-reads")) == 4
    assert seed.pool("graph")[1].environment == "load-s01 production"
    assert seed.users[0].email == "load-user-0@example.com"
    assert seed.id_pool("accounts")[0].startswith("acc_")
    assert seed.ref("connect-connection") == "cxn_synthetic"
    assert "synthetic-password" not in repr(seed.users[0])


def test_a_readable_record_is_refused(tmp_path: Path) -> None:
    with pytest.raises(SeedError, match="0600"):
        Seed.load(write(tmp_path, record(), 0o644))
    with pytest.raises(SeedError, match="run seed:load first"):
        Seed.load(tmp_path / "missing.json")


def test_a_record_of_another_schema_and_missing_pools(tmp_path: Path) -> None:
    with pytest.raises(SeedError, match="openverify/load-seed@1"):
        Seed.from_json({"schema": "other"})
    seed = Seed.from_json({"schema": "openverify/load-seed@1"})
    with pytest.raises(SeedError, match="key pool"):
        seed.pool("api-reads")
    with pytest.raises(SeedError, match="ids"):
        seed.id_pool("accounts")
    with pytest.raises(SeedError, match="reference"):
        seed.ref("x")

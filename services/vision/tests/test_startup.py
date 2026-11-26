"""Start-up checks of the vision image (Phase 11, Workflow 11C, images-11c).

C249.2 as amended for vision (orchestrator decision 18; plan, Workflow 11C Stage 1a amendment 13):
``OPENVERIFY_VISION_SERVICE_TOKEN`` is also read from ``OPENVERIFY_VISION_SERVICE_TOKEN_FILE``
with the API's rules. C257.1 as amended (15): with ``OPENVERIFY_VISION_MODELS_MANIFEST`` set, the
service refuses to start when a model file's SHA-256 differs from the manifest's.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import stat
from pathlib import Path

import pytest

from openverify_vision import startup
from openverify_vision.app import create_app
from openverify_vision.settings import Settings

TOKEN = "synthetic-vision-token-" + "s" * 20
NAME = "OPENVERIFY_VISION_SERVICE_TOKEN"
FILE_NAME = f"{NAME}_FILE"


def secret(tmp_path: Path, text: str, mode: int = 0o440) -> Path:
    path = tmp_path / f"token-{oct(mode)}-{len(list(tmp_path.iterdir()))}"
    path.write_text(text, encoding="utf-8")
    path.chmod(mode)
    return path


def test_reads_the_token_from_its_file_without_trailing_line_ends(tmp_path: Path) -> None:
    env = {FILE_NAME: str(secret(tmp_path, TOKEN + "\r\n\n"))}
    warnings = startup.resolve_secret_files(env, (NAME,))
    assert env[NAME] == TOKEN
    assert warnings == []


def test_keeps_spaces_and_leaves_an_unset_file_form_alone(tmp_path: Path) -> None:
    env = {FILE_NAME: str(secret(tmp_path, f" {TOKEN} \n")), "OTHER_FILE": "/nowhere"}
    startup.resolve_secret_files(env, (NAME,))
    assert env[NAME] == f" {TOKEN} "
    plain = {NAME: TOKEN, FILE_NAME: "  "}
    assert startup.resolve_secret_files(plain, (NAME,)) == []
    assert plain[NAME] == TOKEN


def test_refuses_both_forms_naming_the_variable_never_the_value(tmp_path: Path) -> None:
    env = {NAME: TOKEN, FILE_NAME: str(secret(tmp_path, TOKEN))}
    with pytest.raises(startup.SecretFileError) as raised:
        startup.resolve_secret_files(env, (NAME,))
    assert str(raised.value) == f"{NAME}: is set together with {FILE_NAME}; set one"
    assert TOKEN not in str(raised.value)


@pytest.mark.parametrize(
    ("path", "problem"),
    [
        ("relative/token", "must be an absolute path"),
        ("/nonexistent/openverify/token", "cannot be read"),
    ],
)
def test_refuses_a_relative_or_unreadable_path(path: str, problem: str) -> None:
    with pytest.raises(startup.SecretFileError, match=f"^{FILE_NAME}: {problem}$"):
        startup.resolve_secret_files({FILE_NAME: path}, (NAME,))


def test_refuses_an_empty_file(tmp_path: Path) -> None:
    with pytest.raises(startup.SecretFileError, match=f"^{FILE_NAME}: is empty$"):
        startup.resolve_secret_files({FILE_NAME: str(secret(tmp_path, "\n"))}, (NAME,))


def test_warns_on_a_world_readable_file_but_not_a_group_readable_one(tmp_path: Path) -> None:
    group = startup.resolve_secret_files({FILE_NAME: str(secret(tmp_path, TOKEN, 0o440))}, (NAME,))
    assert group == []
    world = startup.resolve_secret_files({FILE_NAME: str(secret(tmp_path, TOKEN, 0o444))}, (NAME,))
    assert world == [{"event": "secret_file_readable", "variable": FILE_NAME}]


def write_manifest(tmp_path: Path, files: dict[str, bytes], pins: dict[str, str]) -> Path:
    models = tmp_path / "models"
    models.mkdir()
    for filename, data in files.items():
        (models / filename).write_bytes(data)
    manifest = tmp_path / "manifest.json"
    entries = [{"filename": name, "sha256": digest} for name, digest in pins.items()]
    manifest.write_text(json.dumps({"schema_version": 1, "models": entries}), encoding="utf-8")
    return manifest


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_passes_matching_models_and_skips_the_ones_not_fetched(tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path, {"a.onnx": b"alpha"}, {"a.onnx": sha256(b"alpha"), "b.onnx": sha256(b"beta")}
    )
    assert startup.check_model_digests(tmp_path / "models", manifest) == ["a.onnx"]


def test_refuses_a_model_whose_digest_differs_naming_the_file(tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path,
        {"a.onnx": b"alpha", "b.onnx": b"tampered"},
        {"a.onnx": sha256(b"alpha"), "b.onnx": sha256(b"beta")},
    )
    with pytest.raises(startup.ModelDigestError) as raised:
        startup.check_model_digests(tmp_path / "models", manifest)
    assert "b.onnx" in str(raised.value)
    assert "a.onnx" not in str(raised.value)


def test_refuses_a_manifest_it_cannot_read(tmp_path: Path) -> None:
    (tmp_path / "models").mkdir()
    with pytest.raises(startup.ModelDigestError, match="manifest"):
        startup.check_model_digests(tmp_path / "models", tmp_path / "missing.json")


def test_create_app_refuses_to_start_on_a_digest_mismatch(tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path, {"a.onnx": b"tampered"}, {"a.onnx": sha256(b"alpha")})
    settings = Settings.model_validate(
        {"service_token": TOKEN, "models_dir": tmp_path / "models", "models_manifest": manifest}
    )
    with pytest.raises(startup.ModelDigestError, match=r"a\.onnx"):
        create_app(settings)


def test_create_app_reads_the_token_file_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    path = secret(tmp_path, TOKEN + "\n", 0o444)
    monkeypatch.delenv(NAME, raising=False)
    monkeypatch.setenv(FILE_NAME, str(path))
    manifest = write_manifest(tmp_path, {"a.onnx": b"alpha"}, {"a.onnx": sha256(b"alpha")})
    monkeypatch.setenv("OPENVERIFY_VISION_MODELS_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("OPENVERIFY_VISION_MODELS_MANIFEST", str(manifest))
    with caplog.at_level(logging.WARNING, logger="openverify_vision.startup"):
        app = create_app()
    assert app.state.settings.service_token.get_secret_value() == TOKEN
    assert os.environ[NAME] == TOKEN
    assert "secret_file_readable" in caplog.text
    assert TOKEN not in caplog.text
    assert stat.S_IMODE(path.stat().st_mode) == 0o444


def test_create_app_stops_on_a_bad_token_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(NAME, raising=False)
    monkeypatch.setenv(FILE_NAME, str(tmp_path / "missing"))
    with pytest.raises(startup.SecretFileError, match=f"{FILE_NAME}: cannot be read"):
        create_app()

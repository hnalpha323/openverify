"""scripts/fetch_k8s_schemas.py: the offline Kubernetes schemas for kubeconform (C265.3, review F13).

No test touches the network: downloads go through an injected opener serving local bytes, and the
converter is a stand-in written by the test (the pinned kubeconform converter runs only in the real
fetch, a check rather than a test). The stand-in follows the converter's contract: it reads a
document whose "items" are CustomResourceDefinitions, names each file by FILENAME_FORMAT, lower-cased,
in its working directory, and closes the root when DENY_ROOT_ADDITIONAL_PROPERTIES is set.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import io
import json
import re
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "fetch_k8s_schemas.py"
KUBECONFORM_INSTALLER = REPO_ROOT / "infra" / "scripts" / "install-kubeconform.sh"

FAKE_CONVERTER = """\
import json, os, sys
fmt = os.environ["FILENAME_FORMAT"]
for path in sys.argv[1:]:
    with open(path) as f:
        doc = json.load(f)
    for crd in doc["items"]:
        spec = crd["spec"]
        for version in spec["versions"]:
            name = fmt.format(
                kind=spec["names"]["kind"],
                group=spec["group"].split(".")[0],
                fullgroup=spec["group"],
                version=version["name"],
            ).lower() + ".json"
            schema = version["schema"]["openAPIV3Schema"]
            if os.environ.get("DENY_ROOT_ADDITIONAL_PROPERTIES"):
                schema["additionalProperties"] = False
            with open(os.path.basename(name), "w") as out:
                out.write(json.dumps(schema, indent=2) + "\\n")
"""

INT_OR_STRING = {"type": "string", "format": "int-or-string"}


def swagger(**extra: Any) -> dict[str, Any]:
    """A small Kubernetes-shaped Swagger 2.0 document."""
    definitions: dict[str, Any] = {
        "io.k8s.apimachinery.pkg.util.intstr.IntOrString": dict(INT_OR_STRING),
        "io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta": {
            "description": "ObjectMeta",
            "type": "object",
            "properties": {"name": {"type": "string"}},
        },
        "io.k8s.api.core.v1.ServicePort": {
            "type": "object",
            "required": ["port"],
            "properties": {
                "port": {"type": "integer"},
                "targetPort": {
                    "$ref": "#/definitions/io.k8s.apimachinery.pkg.util.intstr.IntOrString",
                    "description": "the target",
                },
            },
        },
        "io.k8s.api.core.v1.ServiceSpec": {
            "type": "object",
            "properties": {
                "ports": {
                    "type": "array",
                    "items": {"$ref": "#/definitions/io.k8s.api.core.v1.ServicePort"},
                }
            },
        },
        "io.k8s.api.core.v1.Service": {
            "type": "object",
            "properties": {
                "metadata": {
                    "$ref": "#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta",
                    "description": "Standard object's metadata.",
                },
                "spec": {"$ref": "#/definitions/io.k8s.api.core.v1.ServiceSpec"},
            },
            "x-kubernetes-group-version-kind": [
                {"group": "", "kind": "Service", "version": "v1"}
            ],
        },
        "io.k8s.api.apps.v1.Deployment": {
            "type": "object",
            "properties": {
                "metadata": {
                    "$ref": "#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta"
                },
                "spec": {
                    "type": "object",
                    "properties": {"replicas": {"type": "integer"}},
                },
            },
            "x-kubernetes-group-version-kind": [
                {"group": "apps", "kind": "Deployment", "version": "v1"}
            ],
        },
        "io.k8s.api.networking.v1.NetworkPolicy": {
            "type": "object",
            "properties": {"spec": {"type": "object"}},
            "x-kubernetes-group-version-kind": [
                {"group": "networking.k8s.io", "kind": "NetworkPolicy", "version": "v1"}
            ],
        },
        "io.k8s.apimachinery.pkg.apis.meta.v1.DeleteOptions": {
            "type": "object",
            "properties": {"dryRun": {"type": "array", "items": {"type": "string"}}},
            "x-kubernetes-group-version-kind": [
                {"group": "", "kind": "DeleteOptions", "version": "v1"},
                {"group": "apps", "kind": "DeleteOptions", "version": "v1"},
            ],
        },
    }
    definitions.update(extra)
    return {"swagger": "2.0", "definitions": definitions}


@pytest.fixture(scope="module")
def ks() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_k8s_schemas", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_k8s_schemas"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def no_network(ks: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    """A test that reaches the real opener fails instead of downloading."""

    def refuse(url: str, timeout: float) -> Any:
        raise AssertionError(f"a test tried to download {url}")

    monkeypatch.setattr(ks, "_default_opener", refuse)


class FakeResponse(io.BytesIO):
    pass


class FakeOpener:
    """Serves fixed bytes per URL; an Exception value is raised for that many calls first."""

    def __init__(
        self,
        payloads: dict[str, bytes],
        failures: dict[str, list[Exception]] | None = None,
    ):
        self.payloads = payloads
        self.failures = failures or {}
        self.calls: list[str] = []

    def __call__(self, url: str, timeout: float) -> FakeResponse:
        self.calls.append(url)
        pending = self.failures.get(url)
        if pending:
            raise pending.pop(0)
        return FakeResponse(self.payloads[url])


def pin_for(
    ks: ModuleType, data: bytes, filename: str = "doc.json", **overrides: Any
) -> Any:
    fields: dict[str, Any] = {
        "filename": filename,
        "url": f"https://example.invalid/{filename}",
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    }
    fields.update(overrides)
    return ks.Pin(**fields)


# ---- the pins -----------------------------------------------------------------------------------


def test_the_three_kubernetes_documents_are_pinned_by_tag_commit_size_and_sha256(
    ks: ModuleType,
) -> None:
    releases = ks.KUBERNETES_RELEASES
    assert list(releases) == ["1.35", "1.36", "1.37"]
    expected = {
        "1.35": (
            "1.35.9",
            "329000efd0b26bd78155e51e4df449130f0fca00",
            3_846_687,
            "483500149ee52ce5753d75f5639101d985bb4f5e902cc05b1ba7627465d62446",
        ),
        "1.36": (
            "1.36.5",
            "ad950d1cc78b0183c476bd4d3f1934c104229727",
            4_108_739,
            "dcede2063da1d7ad62ecb5af8adb6d7fabd0b52385a7fa0048afb491dac90450",
        ),
        "1.37": (
            "1.37.1",
            "f78e722310e50bcaca9276be22276d9e91d91308",
            4_475_339,
            "465276aedf437726de5a6ed23a41b86d78bb0d347edf251a755ae26a93cdd8a6",
        ),
    }
    for minor, (version, commit, size, sha) in expected.items():
        release = releases[minor]
        assert release.minor == minor
        assert release.version == version
        assert release.commit == commit
        assert release.document.size == size
        assert release.document.sha256 == sha
        assert release.document.url == (
            f"https://raw.githubusercontent.com/kubernetes/kubernetes/v{version}"
            "/api/openapi-spec/swagger.json"
        )
        assert release.document.filename == f"swagger-v{version}.json"
        assert re.fullmatch(r"[0-9a-f]{64}", release.bundle_sha256)


def test_the_converter_is_kubeconforms_own_script_pinned_as_its_installer_pins_it(
    ks: ModuleType,
) -> None:
    installer = KUBECONFORM_INSTALLER.read_text()
    commit = re.search(
        r'^KUBECONFORM_SCHEMA_CONVERTER_COMMIT="([0-9a-f]{40})"',
        installer,
        re.MULTILINE,
    )
    sha = re.search(
        r'^KUBECONFORM_SCHEMA_CONVERTER_SHA256="([0-9a-f]{64})"',
        installer,
        re.MULTILINE,
    )
    assert commit is not None
    assert sha is not None
    converter = ks.CONVERTER
    assert converter.url == (
        f"https://raw.githubusercontent.com/yannh/kubeconform/{commit.group(1)}"
        "/scripts/openapi2jsonschema.py"
    )
    assert converter.sha256 == sha.group(1)
    assert converter.filename == "openapi2jsonschema.py"
    assert converter.size == 7094


def test_no_third_party_schema_repository_is_named_and_only_the_standard_library_is_imported() -> (
    None
):
    source = SCRIPT.read_text()
    for name in ("kubernetes-json-schema", "datreeio", "instrumenta"):
        assert name not in source
    imported: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imported.add(node.module.split(".")[0])
    assert imported, "the script imports something"
    assert imported <= set(sys.stdlib_module_names) | {"__future__"}


def test_the_default_destination_is_gitignored_data() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text().splitlines()
    assert "data/*" in gitignore
    assert "!data/k8s-schemas" not in "\n".join(gitignore)


# ---- fetch --------------------------------------------------------------------------------------


def test_fetch_writes_the_file_only_after_its_digest_matches(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b'{"swagger": "2.0"}'
    pin = pin_for(ks, data)
    opener = FakeOpener({pin.url: data})
    path = ks.fetch(pin, tmp_path / "cache", opener=opener)
    assert path == tmp_path / "cache" / "doc.json"
    assert path.read_bytes() == data
    assert opener.calls == [pin.url]


def test_fetch_refuses_a_digest_mismatch_and_leaves_nothing(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b'{"swagger": "2.0"}'
    pin = pin_for(ks, data, sha256="0" * 64)
    cache = tmp_path / "cache"
    with pytest.raises(ks.ChecksumMismatchError, match="doc.json"):
        ks.fetch(pin, cache, opener=FakeOpener({pin.url: data}))
    assert list(cache.iterdir()) == []


def test_fetch_refuses_more_bytes_than_the_pin_declares(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b"x" * 100
    pin = pin_for(ks, data, size=10)
    cache = tmp_path / "cache"
    with pytest.raises(ks.DownloadTooLargeError):
        ks.fetch(pin, cache, opener=FakeOpener({pin.url: data}))
    assert list(cache.iterdir()) == []


def test_fetch_refuses_fewer_bytes_than_the_pin_declares(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b"x" * 10
    pin = pin_for(ks, data, size=11)
    with pytest.raises(ks.FetchError, match="10 bytes"):
        ks.fetch(pin, tmp_path / "cache", opener=FakeOpener({pin.url: data}))


def test_fetch_refuses_a_url_that_is_not_https(ks: ModuleType, tmp_path: Path) -> None:
    data = b"x"
    pin = pin_for(ks, data, url="http://example.invalid/doc.json")
    opener = FakeOpener({pin.url: data})
    with pytest.raises(ks.FetchError, match="https"):
        ks.fetch(pin, tmp_path / "cache", opener=opener)
    assert opener.calls == []


def test_fetch_skips_a_cached_file_whose_digest_matches(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b"cached bytes"
    pin = pin_for(ks, data)
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / pin.filename).write_bytes(data)
    opener = FakeOpener({})
    assert ks.fetch(pin, cache, opener=opener).read_bytes() == data
    assert opener.calls == []


def test_fetch_replaces_a_cached_file_whose_digest_differs(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b"the pinned bytes"
    pin = pin_for(ks, data)
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / pin.filename).write_bytes(b"tampered")
    opener = FakeOpener({pin.url: data})
    assert ks.fetch(pin, cache, opener=opener).read_bytes() == data
    assert opener.calls == [pin.url]


def test_fetch_retries_a_transient_failure_then_succeeds(
    ks: ModuleType, tmp_path: Path
) -> None:
    import urllib.error

    data = b"eventually"
    pin = pin_for(ks, data)
    opener = FakeOpener({pin.url: data}, {pin.url: [urllib.error.URLError("reset")]})
    sleeps: list[float] = []
    path = ks.fetch(pin, tmp_path / "cache", opener=opener, sleep=sleeps.append)
    assert path.read_bytes() == data
    assert opener.calls == [pin.url, pin.url]
    assert sleeps == [2.0]


def test_fetch_gives_up_after_three_attempts(ks: ModuleType, tmp_path: Path) -> None:
    import urllib.error

    data = b"never"
    pin = pin_for(ks, data)
    failures: list[Exception] = [urllib.error.URLError("down") for _ in range(3)]
    opener = FakeOpener({pin.url: data}, {pin.url: failures})
    with pytest.raises(ks.FetchError, match="3 attempts"):
        ks.fetch(pin, tmp_path / "cache", opener=opener, sleep=lambda _s: None)
    assert len(opener.calls) == 3


def test_fetch_does_not_retry_a_checksum_mismatch(
    ks: ModuleType, tmp_path: Path
) -> None:
    data = b"wrong"
    pin = pin_for(ks, data, sha256="1" * 64)
    opener = FakeOpener({pin.url: data})
    with pytest.raises(ks.ChecksumMismatchError):
        ks.fetch(pin, tmp_path / "cache", opener=opener, sleep=lambda _s: None)
    assert len(opener.calls) == 1


# ---- the stand-alone expansion ------------------------------------------------------------------


def test_expand_definition_inlines_every_reference_and_keeps_the_local_description(
    ks: ModuleType,
) -> None:
    definitions = swagger()["definitions"]
    service = ks.expand_definition(definitions, "io.k8s.api.core.v1.Service")
    assert "$ref" not in json.dumps(service)
    port = service["properties"]["spec"]["properties"]["ports"]["items"]
    assert port["required"] == ["port"]
    assert port["properties"]["targetPort"] == {
        **INT_OR_STRING,
        "description": "the target",
    }
    assert (
        service["properties"]["metadata"]["description"]
        == "Standard object's metadata."
    )
    assert service["properties"]["metadata"]["properties"] == {
        "name": {"type": "string"}
    }
    # The definitions themselves are not modified.
    assert definitions["io.k8s.api.core.v1.ServiceSpec"]["properties"]["ports"][
        "items"
    ] == {"$ref": "#/definitions/io.k8s.api.core.v1.ServicePort"}


def test_expand_definition_stops_a_recursive_reference_with_an_open_schema(
    ks: ModuleType,
) -> None:
    props = "io.k8s.apiextensions-apiserver.pkg.apis.apiextensions.v1.JSONSchemaProps"
    definitions = {
        props: {
            "type": "object",
            "properties": {
                # A property named "$ref" is a schema, not a reference.
                "$ref": {"type": "string"},
                "not": {"$ref": f"#/definitions/{props}"},
                "items": {"type": "array", "items": {"$ref": f"#/definitions/{props}"}},
            },
        }
    }
    expanded = ks.expand_definition(definitions, props)
    assert expanded["properties"]["$ref"] == {"type": "string"}
    assert expanded["properties"]["not"] == {}
    assert expanded["properties"]["items"]["items"] == {}


def test_expand_definition_refuses_a_reference_outside_the_definitions(
    ks: ModuleType,
) -> None:
    definitions = {"a": {"properties": {"b": {"$ref": "#/elsewhere/b"}}}}
    with pytest.raises(ks.FetchError, match="#/elsewhere/b"):
        ks.expand_definition(definitions, "a")
    definitions = {"a": {"properties": {"b": {"$ref": "#/definitions/missing"}}}}
    with pytest.raises(ks.FetchError, match="missing"):
        ks.expand_definition(definitions, "a")


# ---- the converter's input ----------------------------------------------------------------------


def test_crd_batches_wrap_one_definition_per_group_version_kind_core_apart(
    ks: ModuleType,
) -> None:
    core, grouped = ks.crd_batches(swagger())
    names = [
        (
            c["spec"]["group"],
            c["spec"]["versions"][0]["name"],
            c["spec"]["names"]["kind"],
        )
        for c in core + grouped
    ]
    assert names == [
        ("", "v1", "DeleteOptions"),
        ("", "v1", "Service"),
        ("apps", "v1", "DeleteOptions"),
        ("apps", "v1", "Deployment"),
        ("networking.k8s.io", "v1", "NetworkPolicy"),
    ]
    assert all(c["spec"]["group"] == "" for c in core)
    assert all(c["spec"]["group"] for c in grouped)
    for crd in core + grouped:
        assert crd["apiVersion"] == "apiextensions.k8s.io/v1"
        assert crd["kind"] == "CustomResourceDefinition"
        assert len(crd["spec"]["versions"]) == 1
        assert "$ref" not in json.dumps(crd)
        assert (
            "x-kubernetes-group-version-kind"
            in crd["spec"]["versions"][0]["schema"]["openAPIV3Schema"]
        )


def test_crd_batches_refuse_two_definitions_that_would_write_the_same_file(
    ks: ModuleType,
) -> None:
    twin = {
        "type": "object",
        "x-kubernetes-group-version-kind": [
            {"group": "apps.example.io", "kind": "Deployment", "version": "v1"}
        ],
    }
    with pytest.raises(ks.FetchError, match="deployment-apps-v1"):
        ks.crd_batches(swagger(**{"io.example.apps.v1.Deployment": twin}))


def test_crd_batches_refuse_a_document_that_is_not_swagger_2(ks: ModuleType) -> None:
    with pytest.raises(ks.FetchError, match="Swagger 2.0"):
        ks.crd_batches({"openapi": "3.0.0", "components": {}})


# ---- the bundle ---------------------------------------------------------------------------------


def test_bundle_digest_is_the_sha256_of_the_sorted_file_list(
    ks: ModuleType, tmp_path: Path
) -> None:
    (tmp_path / "b.json").write_text("{}\n")
    (tmp_path / "a.json").write_text('{"a": 1}\n')
    sums, digest = ks.bundle_digest(tmp_path)
    lines = sums.splitlines()
    assert [line.split("  ")[1] for line in lines] == ["a.json", "b.json"]
    assert lines[1] == hashlib.sha256(b"{}\n").hexdigest() + "  b.json"
    assert digest == hashlib.sha256(sums.encode()).hexdigest()
    (tmp_path / "SHA256SUMS").write_text(sums)
    assert ks.bundle_digest(tmp_path) == (sums, digest)
    (tmp_path / "b.json").write_text("[]\n")
    assert ks.bundle_digest(tmp_path)[1] != digest


# ---- generate, end to end with the stand-in converter --------------------------------------------


@pytest.fixture
def setup(ks: ModuleType, tmp_path: Path) -> Iterator[dict[str, Any]]:
    document = json.dumps(swagger()).encode()
    converter = FAKE_CONVERTER.encode()
    doc_pin = pin_for(ks, document, filename="swagger-v9.99.0.json")
    conv_pin = pin_for(ks, converter, filename="openapi2jsonschema.py")
    calls: list[list[str]] = []

    def runner(cmd: list[str], **kwargs: Any) -> Any:
        calls.append(list(cmd))
        return subprocess.run(cmd, **kwargs)  # noqa: PLW1510 - the caller passes check

    yield {
        "doc": doc_pin,
        "conv": conv_pin,
        "opener": FakeOpener({doc_pin.url: document, conv_pin.url: converter}),
        "runner": runner,
        "calls": calls,
        "dest": tmp_path / "schemas",
        "cache": tmp_path / "cache",
    }


def release_for(ks: ModuleType, doc: Any, bundle_sha256: str) -> Any:
    return ks.KubernetesRelease(
        minor="9.99",
        version="9.99.0",
        commit="f" * 40,
        document=doc,
        bundle_sha256=bundle_sha256,
    )


def expected_bundle(ks: ModuleType, tmp_path: Path, s: dict[str, Any]) -> str:
    """Generate once with a wrong pin to read the digest the stand-in yields."""
    with pytest.raises(ks.BundleMismatchError) as caught:
        ks.generate(
            release_for(ks, s["doc"], "0" * 64),
            tmp_path / "probe",
            s["cache"],
            [sys.executable, "-I"],
            opener=s["opener"],
            runner=s["runner"],
            converter=s["conv"],
        )
    found = re.search(
        r"bundle sha256 ([0-9a-f]{64}) does not match its pin", str(caught.value)
    )
    assert found is not None
    return found.group(1)


def test_generate_writes_one_schema_per_kind_and_its_sums(
    ks: ModuleType, tmp_path: Path, setup: dict[str, Any]
) -> None:
    s = setup
    digest = expected_bundle(ks, tmp_path, s)
    status, got = ks.generate(
        release_for(ks, s["doc"], digest),
        s["dest"],
        s["cache"],
        [sys.executable, "-I"],
        opener=s["opener"],
        runner=s["runner"],
        converter=s["conv"],
    )
    assert (status, got) == ("generated", digest)
    out = s["dest"] / "v9.99.0"
    assert sorted(p.name for p in out.iterdir()) == [
        "SHA256SUMS",
        "deleteoptions-apps-v1.json",
        "deleteoptions-v1.json",
        "deployment-apps-v1.json",
        "networkpolicy-networking-v1.json",
        "service-v1.json",
    ]
    service = json.loads((out / "service-v1.json").read_text())
    assert service["additionalProperties"] is False
    assert "$ref" not in json.dumps(service)
    assert (out / "SHA256SUMS").read_text() == ks.bundle_digest(out)[0]
    # Two converter runs (core, then grouped), each with the pinned file and its own name format.
    runs = s["calls"][-2:]
    assert [cmd[:2] for cmd in runs] == [[sys.executable, "-I"]] * 2
    assert all(cmd[2] == str(s["cache"] / "openapi2jsonschema.py") for cmd in runs)
    # Nothing but the finished version directory is left in the destination.
    assert sorted(p.name for p in s["dest"].iterdir()) == ["v9.99.0"]


def test_generate_passes_the_name_formats_and_the_closed_root(
    ks: ModuleType, tmp_path: Path, setup: dict[str, Any]
) -> None:
    s = setup
    seen: list[dict[str, str]] = []

    def runner(cmd: list[str], **kwargs: Any) -> Any:
        env = kwargs["env"]
        seen.append(
            {
                "FILENAME_FORMAT": env["FILENAME_FORMAT"],
                "DENY": env["DENY_ROOT_ADDITIONAL_PROPERTIES"],
            }
        )
        assert kwargs["check"] is True
        return subprocess.run(cmd, **kwargs)  # noqa: PLW1510 - the caller passes check

    with pytest.raises(ks.BundleMismatchError):
        ks.generate(
            release_for(ks, s["doc"], "0" * 64),
            s["dest"],
            s["cache"],
            [sys.executable, "-I"],
            opener=s["opener"],
            runner=runner,
            converter=s["conv"],
        )
    assert seen == [
        {"FILENAME_FORMAT": "{kind}-{version}", "DENY": "1"},
        {"FILENAME_FORMAT": "{kind}-{group}-{version}", "DENY": "1"},
    ]


def test_generate_refuses_a_bundle_that_differs_from_its_pin_and_keeps_nothing(
    ks: ModuleType, setup: dict[str, Any]
) -> None:
    s = setup
    with pytest.raises(ks.BundleMismatchError, match="v9.99.0"):
        ks.generate(
            release_for(ks, s["doc"], "0" * 64),
            s["dest"],
            s["cache"],
            [sys.executable, "-I"],
            opener=s["opener"],
            runner=s["runner"],
            converter=s["conv"],
        )
    assert list(s["dest"].iterdir()) == []


def test_generate_reports_a_complete_bundle_present_without_converting(
    ks: ModuleType, tmp_path: Path, setup: dict[str, Any]
) -> None:
    s = setup
    digest = expected_bundle(ks, tmp_path, s)
    release = release_for(ks, s["doc"], digest)
    args = (release, s["dest"], s["cache"], [sys.executable, "-I"])
    kwargs = {"opener": s["opener"], "runner": s["runner"], "converter": s["conv"]}
    assert ks.generate(*args, **kwargs) == ("generated", digest)
    runs = len(s["calls"])
    assert ks.generate(*args, **kwargs) == ("present", digest)
    assert len(s["calls"]) == runs
    # A changed file makes the bundle incomplete: it is generated again.
    (s["dest"] / "v9.99.0" / "service-v1.json").write_text("{}\n")
    assert ks.generate(*args, **kwargs) == ("generated", digest)
    assert len(s["calls"]) == runs + 2


def test_generate_reports_a_failed_converter_and_keeps_nothing(
    ks: ModuleType, setup: dict[str, Any]
) -> None:
    s = setup
    broken = b"import sys\nsys.exit(4)\n"
    conv = pin_for(ks, broken, filename="openapi2jsonschema.py")
    opener = FakeOpener(
        {s["doc"].url: json.dumps(swagger()).encode(), conv.url: broken}
    )
    with pytest.raises(ks.FetchError, match="converter"):
        ks.generate(
            release_for(ks, s["doc"], "0" * 64),
            s["dest"],
            s["cache"],
            [sys.executable, "-I"],
            opener=opener,
            runner=s["runner"],
            converter=conv,
        )
    assert list(s["dest"].iterdir()) == []


# ---- the location kubeconform reads, and the command line ----------------------------------------


def test_schema_location_names_the_version_directory_in_kubeconforms_template(
    ks: ModuleType, tmp_path: Path
) -> None:
    release = ks.KUBERNETES_RELEASES["1.36"]
    assert ks.schema_location(release, tmp_path) == (
        f"{tmp_path}/v1.36.5/{{{{ .ResourceKind }}}}{{{{ .KindSuffix }}}}.json"
    )


def test_main_prints_the_location_for_a_minor_version(
    ks: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert ks.main(["--print-location", "1.37", "--dest", str(tmp_path)]) == 0
    assert capsys.readouterr().out == (
        f"{tmp_path}/v1.37.1/{{{{ .ResourceKind }}}}{{{{ .KindSuffix }}}}.json\n"
    )


def test_main_refuses_an_unpinned_version(
    ks: ModuleType, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as exited:
        ks.main(["--version", "1.34"])
    assert exited.value.code == 2
    assert "1.34" in capsys.readouterr().err


def test_main_generates_from_a_filled_cache_and_prints_each_digest(
    ks: ModuleType,
    tmp_path: Path,
    setup: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    s = setup
    digest = expected_bundle(ks, tmp_path, s)
    # The cache now holds both pinned files, so main downloads nothing.
    monkeypatch.setattr(
        ks, "KUBERNETES_RELEASES", {"9.99": release_for(ks, s["doc"], digest)}
    )
    monkeypatch.setattr(ks, "CONVERTER", s["conv"])
    argv = [
        "--dest",
        str(s["dest"]),
        "--cache",
        str(s["cache"]),
        "--python",
        sys.executable,
    ]
    assert ks.main(argv) == 0
    out = capsys.readouterr().out
    assert out == f"v9.99.0: generated, 5 schemas, bundle sha256 {digest}\n"
    assert ks.main(argv) == 0
    assert (
        capsys.readouterr().out
        == f"v9.99.0: present, 5 schemas, bundle sha256 {digest}\n"
    )


def test_main_reports_a_failure_with_exit_1(
    ks: ModuleType,
    tmp_path: Path,
    setup: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    s = setup
    expected_bundle(ks, tmp_path, s)
    monkeypatch.setattr(
        ks, "KUBERNETES_RELEASES", {"9.99": release_for(ks, s["doc"], "0" * 64)}
    )
    monkeypatch.setattr(ks, "CONVERTER", s["conv"])
    argv = [
        "--dest",
        str(s["dest"]),
        "--cache",
        str(s["cache"]),
        "--python",
        sys.executable,
    ]
    assert ks.main(argv) == 1
    assert "does not match its pin" in capsys.readouterr().err


def test_the_default_converter_interpreter_is_the_supply_chain_environment(
    ks: ModuleType,
) -> None:
    command = ks.default_python()
    venv = REPO_ROOT / "security" / "python" / ".venv" / "bin" / "python"
    if venv.exists():
        assert command == [str(venv), "-I"]
    else:
        assert command[:4] == [
            "uv",
            "run",
            "--project",
            str(REPO_ROOT / "security" / "python"),
        ]
        assert command[-3:] == ["--frozen", "python", "-I"]

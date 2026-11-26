# Workflow 11C, chart-policy-11c (family K: C264, C265)

Owner of `deploy/helm/openverify/templates/{networkpolicies.yaml,_security.tpl}`, `deploy/helm/openverify/{tests,ci}/` (except chart-11c's `tests/c263-*_test.yaml`), `deploy/helm/openverify/ci/{kind.sh,chart-checks.sh,fixtures/}` and `scripts/fetch_k8s_schemas.py` with `scripts/tests/`. Stage 2, beside the other 11C builders (rule 25: parallel gates). Every timing below carries `cat /proc/loadavg`.

Waits (rule 17): scanners-11c "chart-tools" and chart-11c "components" gate the templates and the unit tests; images-11c "images" gates only the kind slice. `scripts/fetch_k8s_schemas.py` needs no wait and is built first.

## 1. `scripts/fetch_k8s_schemas.py` (C265.3, review F13)

The pins are contracts-11c's (plan Stage 1a amendment item 4): the Kubernetes `api/openapi-spec/swagger.json` at v1.35.9, v1.36.5 and v1.37.1 by tag, commit, size and SHA-256, and kubeconform's `scripts/openapi2jsonschema.py` at `02374e58` by SHA-256 (the same pins `infra/scripts/install-kubeconform.sh` carries, which a test cross-checks).

What the pinned converter does and does not do (read at its pinned bytes): it converts **CustomResourceDefinition** documents only (a document whose `kind` is `CustomResourceDefinition`, or a document's `items`), names each file by `FILENAME_FORMAT` (`{kind}`, `{group}` = the group's first label, `{fullgroup}`, `{version}`, lower-cased) in its working directory, adds `additionalProperties: false` wherever `properties` appear (the root too with `DENY_ROOT_ADDITIONAL_PROPERTIES`), and turns `format: int-or-string` into `oneOf` string or integer. It does not read a Swagger 2.0 document and does not resolve `$ref`. So the script (standard library, `python3 -I`):
1. fetches each pinned file into a cache, writing it only after its size and SHA-256 match (https only, three attempts on a transient error, never on a mismatch);
2. expands each definition that carries `x-kubernetes-group-version-kind` stand-alone (every `#/definitions/` reference inlined, the referencing schema's own `description` kept; a recursive reference, only `JSONSchemaProps` in these documents, becomes an open schema `{}`; a property named `$ref` is a schema, not a reference);
3. wraps each group/version/kind in a CustomResourceDefinition and runs the **pinned converter itself** twice, core kinds with `FILENAME_FORMAT={kind}-{version}` and grouped kinds with `{kind}-{group}-{version}`, both with `DENY_ROOT_ADDITIONAL_PROPERTIES=1`; that is kubeconform's own file layout (`{{ .ResourceKind }}{{ .KindSuffix }}.json`, where the suffix is `-<group's first label>-<version>`, or `-<version>` for the core group), so `-strict` checks against closed schemas;
4. writes `SHA256SUMS` over the files and compares its SHA-256 (the bundle digest) with the version's pin before moving the directory into place; a mismatch keeps nothing.

The converter imports PyYAML, so it runs with `security/python`'s interpreter (`security/python/.venv/bin/python -I`, or `uv run --project security/python --frozen python -I`), while the script itself stays standard-library.

### Stub (names only, so the RED test compiles)

`scripts/fetch_k8s_schemas.py` with the frozen names: `Pin`, `KubernetesRelease`, `KUBERNETES_RELEASES`, `CONVERTER`, `fetch`, `default_python`, `expand_definition`, `crd_batches`, `bundle_digest`, `generate`, `schema_location`, `main`, and the errors `FetchError`, `ChecksumMismatchError`, `DownloadTooLargeError`, `BundleMismatchError`. `ruff check`, `ruff format --check` and `mypy --strict` pass on it.

### RED

`scripts/tests/test_fetch_k8s_schemas.py`: 32 tests, no network (an injected opener serving local bytes, and a stand-in converter written by the test following the converter's contract above).

```
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . scripts/tests/test_fetch_k8s_schemas.py -p no:cacheprovider
FAILED ...test_the_three_kubernetes_documents_are_pinned_by_tag_commit_size_and_sha256   AssertionError: assert [] == ['1.35', '1.36', '1.37']
FAILED ...test_the_converter_is_kubeconforms_own_script_pinned_as_its_installer_pins_it   AssertionError: assert '' == 'https://raw....jsonschema.py'
FAILED ...test_schema_location_names_the_version_directory_in_kubeconforms_template      KeyError: '1.36'
FAILED (27 more)                                                                          NotImplementedError
========================= 30 failed, 2 passed in 1.60s =========================
```

The two that pass already: the script imports only the standard library, and `data/` (the default destination, `data/k8s-schemas/`) is gitignored and docker-ignored.

### GREEN

The script built as above. The bundle digests were read from the first generation (a run with placeholder pins refuses with the digest it found), generated a second time into a fresh directory to show the result is stable, then pinned in `KUBERNETES_RELEASES`. Two fixes on the way, each caught by a test: `generate`'s converter pin is read at call time (a default bound at definition time ignored the test's patched pin and reached the real opener), and an autouse fixture now replaces the real opener with one that fails, so no test can download.

```
$ uv run --project security/python --frozen ruff check scripts/fetch_k8s_schemas.py scripts/tests   -> All checks passed!
$ uv run --project security/python --frozen ruff format --check scripts/fetch_k8s_schemas.py scripts/tests   -> 2 files already formatted
$ uv run --project security/python --frozen mypy --strict scripts/fetch_k8s_schemas.py   -> Success: no issues found in 1 source file
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . scripts/tests/test_fetch_k8s_schemas.py -p no:cacheprovider
scripts/fetch_k8s_schemas.py     247      6     66      4    97%   163-166, 261, 308, 311, 398
============================== 32 passed in 1.81s ==============================
```

The real run (a check, not a test), from an empty `data/k8s-schemas/` (the four downloads from raw.githubusercontent.com, each verified; load 4.04 3.23 2.41 after it):

```
$ python3 -I scripts/fetch_k8s_schemas.py
v1.35.9: generated, 305 schemas, bundle sha256 98fefc597b674ac073ec50413b5873dbeadcda2da3fa285f09c41685589503f2
v1.36.5: generated, 311 schemas, bundle sha256 d5846791129912b72265f1ebb4d38f42631ec52aaafd6127410e760395078a7f
v1.37.1: generated, 325 schemas, bundle sha256 385016da5a9e39b2f5e94c98f88c157feee45f8c7033f81014067e288db17a0e
69.53 s wall     (rc 0; about 20-26 s of it per version is the pinned converter under PyYAML's pure-Python loader)
$ python3 -I scripts/fetch_k8s_schemas.py      (again)  -> v1.35.9: present, ... (each "present", no download, no conversion)
```

A note for the chart checks: the Kubernetes document types a `Quantity` as a string, so these strict schemas refuse a bare number such as `cpu: 1` (the API server accepts it); the chart writes quantities as strings. kubeconform reads a bundle with `-strict -kubernetes-version <x.y.z> -schema-location "$(python3 -I scripts/fetch_k8s_schemas.py --print-location <x.y>)"`.

## 2. Continuation after the clean stop (2026-11-15)

The stop left nothing of this area uncommitted; the three commits above (`b9cefead3` stub, `17ea4c7f8` RED, `ed015508b` GREEN) stand and nothing was redone. Waits (rule 17), each read from its commit before anything that needed it was edited or run: scanners-11c "CHECKPOINT chart-tools DONE at 29343142f" (`e80e395a2`); chart-11c "CHECKPOINT components DONE at f3af88a82" (`c5f31cdfe`). Tools as run: `helm` v4.3.1, `helm3` v3.22.1, helm-unittest 1.2.1, kubeconform 0.8.0 (all in `~/.local/bin` from scanners-11c's installers).

## 3. The security helpers (C264.1, C264.3, C264.4, C249.1, C249.2)

### RED

`deploy/helm/openverify/tests/c264-security_test.yaml` (28 cases): the restricted profile pod by pod (pod and container contexts in full, the migrate Job's two containers), no Secret in any template, one projected volume per process at mode 0440 (288) holding its own Secret and the data stores it reads (C264.3's lists, the registry's `processes`), each read as `<NAME>_FILE`; `S3_ACCESS_KEY_ID` as the one `secretKeyRef` variable (not a secret and no `_FILE` form in the registry); the refusals of a key the process does not read and of a store's variable among a process's own keys; the CA files per store; vision's controls one by one.

```
$ cat /proc/loadavg
3.37 3.78 2.22 1/704 1927158
$ helm unittest -f 'tests/c264-security_test.yaml' deploy/helm/openverify     (rc 1)
	- runs the API's pod restricted
		- asserts[0] `equal` fail    (no seccompProfile)
		- asserts[1] `equal` fail    (no capabilities, privileged, runAsNonRoot, seccompProfile)
	... the same for the worker, vision, the flow, the console, the runner and the migrate Job
	- mounts the API's Secret and the data stores it reads as files at 0440
		- asserts[0] `contains` fail   (no "secrets" volume: the stub renders nothing)
	... every Secret, CA and refusal case
Test Suites: 1 failed, 0 passed, 1 total
Tests:       21 failed, 7 passed, 28 total
```

The seven that pass already hold on the stubs and stay as regressions: no Secret in any template, no secret volume or variable while no Secret is named, the flow server with no CA, and four of vision's controls (uid 10001, read-only root, no privilege escalation, 4 GiB).

### GREEN

`templates/_security.tpl`: the restricted pod and container contexts (a uid or gid of 0 fails the render); `/tmp` as before; two helpers of this area's own beside the frozen twelve, `openverify.secretSources` and `openverify.caSources` (`infra/tests/chart-skeleton.test.sh`'s frozen set widened by these two names as a named borrowed edit, its own commit); one projected volume `secrets` per process (defaultMode 288 = 0440) with the process's own Secret first and the stores it reads under the variables' names, mounted read-only at `/run/secrets/openverify`, and `<NAME>_FILE` for each file; `S3_ACCESS_KEY_ID` from the S3 Secret as a `secretKeyRef` (the registry: not a secret, no `_FILE`); the names each process may hold are the registry's secrets of that process less the stores' variables (a pattern for migrate's seeded passwords); one projected volume `ca` (292 = 0444) at `/etc/openverify/ca` with `<store>.pem` and the `*_CA_FILE` variables (postgres and valkey for the API, the worker and migrate; s3 for the API and the worker).

```
$ helm unittest -f 'tests/c264-security_test.yaml' deploy/helm/openverify     (rc 0)
Tests:       28 passed, 28 total
$ helm unittest deploy/helm/openverify ; helm3 unittest deploy/helm/openverify
Tests:       34 failed, 87 passed, 121 total    (each; every failure is in chart-11c's c263-operations_test.yaml, its RED ac862e94e, not this area's)
$ helm lint deploy/helm/openverify      (rc 0)
```

## 4. The network policies (C264.2, C263.5, C263.6; B10-I1, H8, H9, review P19)

Stub `templates/networkpolicies.yaml` (renders nothing) committed alone first, so the suite compiles.

### RED

`deploy/helm/openverify/tests/c264-networkpolicies_test.yaml` (27 cases): no policy when off; the default deny of the release's pods both ways; nine documents in job mode, seven in pvc mode with the runner off; vision reached only by the API and the worker and with `egress: []` in job mode, in pvc mode and whatever extra destinations are listed; the runner reached only by the worker with no egress; the API's http port open, its internal port only from the flow server; DNS to the cluster resolver; the public-internet rule as two `ipBlock`s (IPv4 and IPv6, each leaving out its family's private, loopback, link-local (metadata), CGNAT and local ranges); the worker without ingress, with the runner and the listed webhook, provider and list-sync destinations; the in-cluster stores by selector from the API and the worker, migrate reaching only DNS and Postgres; external stores by `egress.dataStores`; SMTP from the API and the worker; private identity providers from the API only; the console reaching only DNS and the API, the flow server only DNS and the internal listener; the models-fetch Job alone reaching the public internet, or only `egress.modelHosts` when listed.

```
$ cat /proc/loadavg
4.75 4.09 2.67 2/735 1949151
$ helm unittest -f 'tests/c264-networkpolicies_test.yaml' deploy/helm/openverify     (rc 1)
	- denies every ingress and egress of the release's pods by default
		- asserts[0] `isKind` fail
	- lets only the API and the worker reach vision, on its port
		- asserts[0] `equal` fail
	... every case but the first (the stub renders nothing)
Tests:       26 failed, 1 passed, 27 total
```
The one that passes already is "renders no policy when networkPolicy.enabled is false".

### GREEN

`templates/networkpolicies.yaml`: the default deny (`<fullname>-default-deny`, the release's pods by name and instance) and one policy per component (`<fullname>-<component>`), each built as data and written with `toYaml`; the rules as the template's header lists them.

```
$ helm unittest -f 'tests/c264-networkpolicies_test.yaml' deploy/helm/openverify    (rc 0)
Tests:       27 passed, 27 total
$ helm3 unittest -f 'tests/c264-*_test.yaml' deploy/helm/openverify                  (rc 0)
Tests:       55 passed, 55 total
$ helm template ov deploy/helm/openverify --namespace verify | kubeconform -strict -summary -kubernetes-version <m>.0 -schema-location "$(python3 -I scripts/fetch_k8s_schemas.py --print-location <m>)"
1.35, 1.36, 1.37: Summary: 31 resources found parsing stdin - Valid: 31, Invalid: 0, Errors: 0, Skipped: 0
```

## 5. The ingress helpers (C264.5, C255.1, C250.3)

chart-11c's `templates/ingress.yaml` (its operations GREEN, `265623f42`) calls `openverify.ingressAnnotations` per host and path class and puts `openverify.internalPathDeny`'s paths before the API host's `/`.

The body limits, measured against the routes (read at this commit): the list importer's `IMPORTER_BODY_LIMIT_BYTES` is 26,670,764 bytes (`apps/api/src/routes/server/importers.ts:41`) and a transaction file's multipart body is capped at the field's `max-file-size-bytes`, at most 20,000,000 (`apps/api/src/routes/server/transactions.ts:361-372`), so 28m (29,360,128 bytes) holds both and stays. The ordinary routes are not all "10 MiB plus multipart overhead": `PATCH /api/v1/cases/:id` carries a base64 attachment up to `CASE_PATCH_BODY_LIMIT` = 14 MiB (`apps/api/src/routes/server/cases.ts:66`), which the frozen 12m refuses at the ingress. The default `ingress.maxBodySize` therefore becomes 15m (a one-line borrowed edit of chart-11c's `values.yaml`, listed in contractDeviations); case attachments' multipart route takes 10 MiB + 64 KiB and the flow's uploads 10 MiB (`MAX_UPLOAD_BYTES`), both under it.

### RED

`deploy/helm/openverify/tests/c264-ingress_test.yaml` (15 cases): HSTS on each host (the record annotation `openverify.dev/strict-transport-security` and F5 NGINX's `nginx.org/hsts*`; the community controller's own HSTS setting defaults to the same one year with subdomains), preload only when asked, none when off; the body limit per path class (15m default, 28m import and transaction files) under both NGINX controllers' keys; the HTTPS redirect; a host that no `ingress.tls` entry names refused (TLS required); the operator's `ingress.annotations` merged last; `/api/v1/internal` first on the API host, to `<fullname>-api-internal-deny`, a Service the chart never creates, so it has no endpoint; no Ingress routes the internal listener.

```
$ cat /proc/loadavg
5.29 5.03 3.46 4/863 1979398
$ helm unittest -f 'tests/c264-ingress_test.yaml' deploy/helm/openverify     (rc 1)
	- sets HSTS on the API host / the flow host / the console host   (no annotation: the stub renders nothing)
	- limits the API's ordinary paths to ingress.maxBodySize, 15m by default
	- refuses a host that no ingress.tls entry names     `failedTemplate` fail
	- sends /api/v1/internal on the API host to a backend that has no endpoint, before /
Tests:       12 failed, 3 passed, 15 total
```
The three that pass already: five Ingresses, no HSTS annotation when off, and no Ingress routing the internal listener.

### GREEN

`openverify.ingressAnnotations` and `openverify.internalPathDeny` filled as the RED describes, with one change on the way: the RED's refusal of a host that no `ingress.tls` entry names broke four of chart-11c's own ingress cases (hosts without TLS), and a host served by the controller's default certificate or behind a load balancer that terminates TLS is a valid install, so "TLS required" is the HTTPS redirect on every host (`force-ssl-redirect`, which holds without a `tls` entry) and HSTS, not a render failure; that case now asserts the redirect without a `tls` entry.

```
$ helm unittest deploy/helm/openverify      (rc 1, before the values.yaml edit)
 FAIL  c264 ingress
	- limits the API's ordinary paths to ingress.maxBodySize, 15m by default   (values.yaml still says 12m)
Tests:       1 failed, 182 passed, 183 total
```

## 6. `ci/chart-checks.sh` (C265.1-C265.3; the supply-chain `chart` step)

### RED

`deploy/helm/openverify/ci/tests/chart-checks.test.sh`, a contract test over stand-in tools that log their arguments (no network: the schema fetcher is a stand-in too): the usage; `lint` with Helm 4 and Helm 3, `--strict`, over the defaults, each `ci/*-values.yaml`, each `ci/lint/*-values.yaml` and the kind values with the upgrade overlay (never `ci/fixtures/`), a failure naming its Helm; `unittest` under both Helms; `kubeconform` over the four rendered sets times 1.35.9, 1.36.5 and 1.37.1 (`scripts/fetch_k8s_schemas.py`'s pins, read from the script), `-strict`, the location from the fetcher, never the default (network) location, never `-ignore-missing-schemas`; `trivy` with the pinned checks bundle, `--severity HIGH,CRITICAL --exit-code 1` and an ignore file holding only the unexpired allowlist entries for the chart; `all` in order, each run, failing when one fails; a missing tool failing closed with its installer named.

```
$ bash deploy/helm/openverify/ci/tests/chart-checks.test.sh      (rc 1)
FAIL - chart-checks.sh exists
# 0 passed, 1 failed, 0 skipped
```

### GREEN

`deploy/helm/openverify/ci/chart-checks.sh lint|unittest|kubeconform|trivy|all` as the RED describes (exit 0, 1, 2). `c264-security_test.yaml`'s refusal case now also holds `OPENVERIFY_CODE_RUNNER_TOKEN` in the worker's keys, because chart-11c's new check (the runner token in both the worker's and the runner's keys while the runner is on) answers first otherwise; the case still refuses `OPENVERIFY_FLOW_SERVER_TOKEN` for the same reason as before.

```
$ bash deploy/helm/openverify/ci/tests/chart-checks.test.sh     (rc 0)
# 45 passed, 0 failed, 0 skipped
$ cat /proc/loadavg
6.53 5.82 4.19 10/859 2017192
$ bash deploy/helm/openverify/ci/chart-checks.sh lint          (rc 0)  chart-checks: lint passed in 1s          (defaults only: no ci values file yet)
$ bash deploy/helm/openverify/ci/chart-checks.sh kubeconform   (rc 0)  chart-checks: kubeconform passed in 2s
$ bash deploy/helm/openverify/ci/chart-checks.sh trivy         (rc 0)  chart-checks: trivy passed in 2s
$ helm unittest deploy/helm/openverify                          (rc 0)  Tests: 196 passed, 196 total
```

## 7. `ci/kind.sh`, `ci/fixtures/` and the ci values (C265.4, review F14, verification V15, review H16)

### RED

`deploy/helm/openverify/ci/tests/kind.test.sh`: the fixtures statically (every image pinned by tag and digest, the digests compose and plan item 6 pin; no Secret committed; the chart's namespace enforcing the restricted Pod Security Standard; Postgres's migration role owning the database and the public schema, the runtime role owning nothing, no password in a fixture; the models PersistentVolume and claim; the kind values in pvc mode, policies on, stores by selector, local images never pulled, the two roles; the upgrade moving the flow to the no-guidance image), then `kind.sh` over stand-in kind, kubectl, ct, helm and docker: the usage, `create` on the pinned node image per version with its own kubeconfig (refusing 1.36 and an existing cluster), the cluster found or refused, `load` of the six images (failing closed on a missing build; `OPENVERIFY_KIND_IMAGE_TAG` for release.yml), `fixtures` applying each manifest, the Secrets on stdin and never as arguments, every kubectl call on the cluster's kubeconfig, `models` refusing missing or wrong weights before any copy and never downloading, `install` through `ct install`, `upgrade` through `helm upgrade` with both values files, `delete` of this script's clusters only, and no trace or echo of a secret.

Run with the fixture and values files moved aside (they are this commit's GREEN), so each fails for the intended reason:
```
$ bash deploy/helm/openverify/ci/tests/kind.test.sh      (rc 1)
FAIL - ci/fixtures/namespaces.yaml exists   (and postgres, valkey, rustfs, models-volume)
FileNotFoundError: ... ci/kind-values.yaml
FAIL - every fixture image is pinned by tag and digest
FAIL - the chart's namespace enforces the restricted Pod Security Standard
FAIL - kind.sh exists
# 2 passed, 14 failed, 0 skipped
```

### GREEN

`ci/kind.sh` (each subcommand one call; exit 0, 1, 2), `ci/fixtures/{namespaces,postgres,valkey,rustfs,models-volume}.yaml`, `ci/kind-values.yaml` (ct install's one values file), `ci/upgrade/kind-upgrade-values.yaml` (the upgrade's overlay) and `ci/lint/full-values.yaml` (rendered and checked by chart-checks.sh, never installed: production mode with every optional part on). The test's stand-ins were aligned with kubeconfig-first calls (`kubectl --kubeconfig <file> <verb>`, `helm --kubeconfig <file> <verb>`), which the RED's patterns had written verb-first; what they hold is unchanged.

```
$ bash deploy/helm/openverify/ci/tests/kind.test.sh      (rc 0)
# 69 passed, 0 failed, 0 skipped
$ bash deploy/helm/openverify/ci/chart-checks.sh all     (rc 0; load 5.54 5.80 4.47)
chart-checks: lint passed in 3s          (defaults, ci/kind-values.yaml, ci/lint/full-values.yaml, kind + upgrade; both Helms)
chart-checks: unittest passed in 9s      (196 tests, each Helm)
chart-checks: kubeconform passed in 4s   (33, 27, 41 and 27 resources per set, each of 1.35.9, 1.36.5, 1.37.1: all valid)
chart-checks: trivy passed in 6s
```

## 8. The render-wide policy test (C264.1-C264.5, C265.2)

`deploy/helm/openverify/ci/tests/chart-policy.test.sh`: the names `openverify.secretSources` lets each process hold equal the registry's secrets of that process less the stores' variables (`apps/api/src/config-registry.ts`, parsed), with migrate's seeded-password pattern; then over six rendered sets (the defaults, the kind values, kind with the upgrade overlay, the full lint set, the full set in pvc mode, the full set with the runner off and the plain migrate hook): every pod and container restricted with `/tmp` and only the restricted profile's volume types, every Secret volume at 0440 under the pod's fsGroup, no Secret, no static frame-ancestors, the IP-reputation claim only on the API and the worker and read-only, vision and the runner without egress, the default deny both ways.

It was written after the helpers it guards, so its RED is a mutant: a copy of the chart under `/tmp` with `readOnlyRootFilesystem: false` and `OPENVERIFY_KEK` added to vision's names.
```
$ CHART_DIR=/tmp/cp11c-mutant/chart bash deploy/helm/openverify/ci/tests/chart-policy.test.sh     (rc 1)
FAIL - secrets.vision.keys may hold exactly the registry's secrets of that process (OPENVERIFY_KEK)
FAIL - [the defaults] every pod and container is restricted, with only allowed volumes (openverify-api/api: container context; ...)
... (the same on every set)
$ bash deploy/helm/openverify/ci/tests/chart-policy.test.sh      (rc 0)
# 44 passed, 0 failed, 0 skipped
```

### A defect found by reading release.yml (sbom-release-11c's verify job, `c96b2bfd1`, calls every subcommand with `OPENVERIFY_KIND_IMAGE_TAG="$VERSION"`)

With another tag, `upgrade` passed `--set=flow.image.tag=<tag>` after the overlay, which put the flow server back on the guidance image. RED, the new cases run against the committed `kind.sh` in a mirror of the paths the test reads (`/tmp/cp11c-red-mirror`):
```
$ bash /tmp/cp11c-red-mirror/deploy/helm/openverify/ci/tests/kind.test.sh      (rc 1)
FAIL - upgrade with another tag keeps the flow server's move to the no-guidance image
# 70 passed, 1 failed, 0 skipped
```
GREEN: `tag_sets upgrade` sets `flow.image.tag=<tag>-noguidance`.
```
$ bash deploy/helm/openverify/ci/tests/kind.test.sh      (rc 0)
# 71 passed, 0 failed, 0 skipped
```

## 9. The kind slice before images-11c's checkpoint (create, fixtures, models only)

images-11c's "CHECKPOINT images" had not landed, so only the subcommands that use no image of ours ran, each under the e2e lock, to prove the fixtures early; the cluster was then deleted, and the full ordered run for 1.35 and 1.37 waits for the checkpoint.

| call | rc | wall (lock wait in it) | load before -> after |
|---|---|---|---|
| `kind.sh create 1.35` | 0 | 121 s | 5.00 -> 21.51 |
| `kind.sh fixtures` | 0 | 121 s | 20.99 -> 14.70 |
| `kind.sh models` | 0 | 44 s (about 40 s of lock wait; the script's own "done in 4s") | 13.05 -> 9.54 |
| `kind.sh delete` | 0 | 4 s | 11.08 |

Checked by hand on the live cluster: the roles `openverify_migrator` and `openverify_runtime`, the public schema owned by the migrator, `vector` and `pg_trgm` installed, and the namespace `openverify` labelled `pod-security.kubernetes.io/enforce=restricted`; the claim `openverify-models` bound to the eight weights under `/var/local/openverify-models/09989269558f7aa87f481b37f537422e3967b7475f4adf0c23fda30354c1bcca`.

Other gates run meanwhile: `scripts/tests/test_fetch_k8s_schemas.py` 32 passed (97% of the script); `security/python`'s whole pytest 189 passed at 97.12%; ruff check and format, mypy --strict clean; `python3 -I scripts/fetch_k8s_schemas.py` (a check) found the three bundles present with their pinned digests (1 s); `pnpm format:check` exit 0 (326 s, load 6.1).

## 10. The kind slice after images-11c's checkpoint "images" (`f9b3e4ecd`, `b917cb80e`): the first ordered run on 1.35

The local images were built by images-11c at its checkpoint's sources (no Dockerfile or image source changed after them): api 604 MB, dashboard 388 MB, flow 349 MB, flow-noguidance 330 MB, vision 707 MB, code-runner 380 MB.

| call (each under the e2e lock) | rc | wall | load before -> after |
|---|---|---|---|
| `kind.sh create 1.35` | 0 | 39 s | 0.71 -> 2.35 |
| `kind.sh load` | 0 | 52 s (script 45 s) | 3.23 -> 3.45 |
| `kind.sh fixtures` | 0 | 89 s | 3.33 -> 5.34 |
| `kind.sh models` | 0 | 25 s (script 12 s) | 5.34 -> 3.83 |
| `kind.sh install` | **1** | 500 s | 4.66 -> 1.15 |

The install failed for a reason outside this area: the migrate hook ran (the Deployments were created after it), and the API, the console, the flow server, vision and the runner came up ready under the restricted namespace with the policies on, but the worker never wrote its heartbeat, because it stops at "the code runner tcp: transport is not built yet (Workflow 11C images-11c)": images-11c's "images" checkpoint ships the runner over its Unix socket, and the `tcp:` transport the chart's runner Deployment needs (C263.6) is its later checkpoint "code-runner-tcp". The kind proof therefore also waits for that checkpoint.

A diagnostic (not the recorded proof): the same release upgraded by hand with `--set codeRunner.enabled=false` (41 s), then `kind.sh smoke`. Its first run met a defect of the smoke: it waited for every pod of the release, and the old worker pod sat in `Terminating` inside the worker's 960 s grace period (chart-11c's, above the longest job lease), so the wait timed out (356 s, rc 1). The smoke now counts only the pods not being deleted. Then:
```
$ flock -E 75 -w 240 /tmp/openverify-e2e.lock timeout 590 bash deploy/helm/openverify/ci/kind.sh smoke     (rc 0, 51 s wall, script 15 s; load 1.82)
kind.sh smoke: migrate hook completed; 37 of 37 migrations applied
kind.sh smoke: db:grant-runtime: the runtime role reads and writes, cannot create or update audit_logs, owns nothing
kind.sh smoke: pods ready: 5 of 5
worker-health: fresh, last heartbeat 5 s ago
kind.sh smoke: GET /ready answered 200
kind.sh smoke: inquiry inq_01M7GG8WYX6QHMFTZTC2DXGH2W created through the API (status created)
kind.sh smoke: passed
```
The helm timeouts inside `install` and `upgrade` are now 480 s, so each call stays inside the 10-minute cap of one call (rule 8).

### A defect of the smoke: its port-forward outlived the call and held the e2e lock

`kc ... port-forward ... &` backgrounds a subshell around the `kc` function, so `$!` was the subshell's pid: the EXIT trap stopped the subshell and left `kubectl port-forward` running, with the e2e lock's descriptor that flock hands its child. After the diagnostic smoke above it held `/tmp/openverify-e2e.lock` for about 13 minutes (two of this area's own `delete` calls and images-11c's `images.test.sh flow-noguidance` waited on it); deleting the cluster without the lock ended the port-forward and released it. RED:
```
$ bash deploy/helm/openverify/ci/tests/kind.test.sh      (rc 1)
FAIL - the port-forward is kubectl itself, stopped by the EXIT trap
# 71 passed, 1 failed, 0 skipped
```

GREEN: the port-forward is started as `kubectl --kubeconfig "$kubeconfig" -n "$namespace" port-forward ... &`.
```
$ bash deploy/helm/openverify/ci/tests/kind.test.sh      (rc 0)
# 72 passed, 0 failed, 0 skipped
```

## 11. Two more chart-checks cases

chart-11c's models handoff asks for a check that `deploy/helm/openverify/files/models-manifest.json` stays a byte copy of `models/manifest.json` (its SHA-256 names the models directory, C263.5); `lint` now makes it. The same run met a second defect, found by the clock: the allowlist's expiry was compared with the local date and the test's dates are UTC, so after 19:00 EST (the next day in UTC) an entry expired yesterday in UTC was still applied. RED:
```
$ bash deploy/helm/openverify/ci/tests/chart-checks.test.sh      (rc 1; 2026-11-15 20:xx EST)
FAIL - lint fails when the chart's models manifest is not a byte copy of models/manifest.json (exit 0, expected 1)
FAIL - the message names both files
FAIL - trivy: an expired entry is not
# 44 passed, 3 failed, 0 skipped
```

GREEN: `lint` compares the two manifests (`MODELS_MANIFEST` overrides the source for the test) and the allowlist expiry is compared with the UTC date.
```
$ bash deploy/helm/openverify/ci/tests/chart-checks.test.sh      (rc 0)
# 47 passed, 0 failed, 0 skipped
$ bash deploy/helm/openverify/ci/chart-checks.sh lint            (rc 0)
```

## 12. The kind install and upgrade (after images-11c's checkpoints "images" `f9b3e4ecd` and "code-runner-tcp" `83abb29b7`)

The images are images-11c's local builds, current with every image source at `83abb29b7` (api 18:03, dashboard 18:05, code-runner 18:11, flow and its variant after flow-runtime, vision at its GREEN; no image source changed after them but the runner's `EXPOSE` line). Each call one foreground call under `flock -E 75 -w 240 /tmp/openverify-e2e.lock` (install `-w 60` with `timeout 590`); wall time includes any lock wait (none above a few seconds here).

| call | 1.35: rc, wall, load before -> after | 1.37: rc, wall, load before -> after |
|---|---|---|
| `create <v>` | 0, 37 s, 0.82 -> 1.46 | 0, 76 s, 2.07 -> 2.42 |
| `load` | 0, 34 s, 1.34 -> 2.23 | 0, 52 s, 2.23 -> 3.48 |
| `fixtures` | 0, 68 s, 2.05 -> 2.64 | 0, 75 s, 3.44 -> 3.12 |
| `models` | 0, 10 s, 2.64 -> 2.60 | 0, 2 s, 3.19 -> 3.19 |
| `install` (ct install) | 0, 29 s, 2.39 -> 2.07 | 0, 33 s, 3.25 -> 4.01 |
| `smoke` | 0, 17 s, 2.06 -> 1.75 | 0, 16 s, 3.77 -> 3.60 |
| `upgrade` (and the smoke again) | 0, 48 s, 1.93 -> 2.57 | 0, 48 s, 3.48 -> 5.49 |
| `delete` | 0, 3 s, 2.36 | 0, 5 s, 5.37 |

Every subcommand stays far inside one call's 10 minutes; none was split. The smoke's output, 1.37 (1.35 alike: inquiries `inq_01M7GWSQNRAZSTA4GJ6B7Q9NPB` after install and `inq_01M7GWVAMA5N21GZAGQ2X2D846` after the upgrade):
```
kind.sh smoke: migrate hook completed; 37 of 37 migrations applied
kind.sh smoke: db:grant-runtime: the runtime role reads and writes, cannot create or update audit_logs, owns nothing
kind.sh smoke: pods ready: 6 of 6
worker-health: fresh, last heartbeat 4 s ago
kind.sh smoke: GET /ready answered 200
kind.sh smoke: inquiry inq_01M7GX3ZXTMFPT2EC4NSNP50T5 created through the API (status created)
kind.sh upgrade: revision 1 to 2; the flow server on openverify/flow:11c-local-noguidance
kind.sh upgrade: migrate hook completed; 37 of 37 migrations applied     (its Completed event after the upgrade began)
kind.sh upgrade: pods ready: 7 of 7                                       (the API at two replicas)
worker-health: fresh, last heartbeat 7 s ago
kind.sh upgrade: GET /ready answered 200
kind.sh smoke: inquiry inq_01M7GX5JV8A9XPGKHS6K6F26PH created through the API (status created)
```
The install runs in the namespace `openverify`, which enforces the restricted Pod Security Standard, with the default-deny policies on and enforced by kind's own network plugin (kindnet), the stores reached by selector in `openverify-fixtures`, the worker reaching the runner over `tcp:` with its token, vision with no egress reading the weights from the pvc claim. No cluster and no port-forward was left behind. What this proves is C265.5's: the chart renders, installs, starts and upgrades on kind; not its behaviour under a real cloud's storage, network plugin or load.

## 13. End gates (on the final tree)

```
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . scripts/tests/test_fetch_k8s_schemas.py   (rc 0) 32 passed
$ python3 -I scripts/fetch_k8s_schemas.py      (rc 0, a check) v1.35.9 305 / v1.36.5 311 / v1.37.1 325 schemas, each bundle's SHA-256 its pin
$ bash deploy/helm/openverify/ci/chart-checks.sh all      (rc 0, 18 s, load 2.06)
chart-checks: lint passed in 2s           (helm 4.3.1 and 3.22.1, --strict: defaults, ci/kind-values.yaml, ci/lint/full-values.yaml, kind + upgrade overlay; the models manifest copy)
chart-checks: unittest passed in 7s       (196 tests under each Helm: chart-11c's c263-* and this area's c264-*)
chart-checks: kubeconform passed in 3s    (27/33/41/27 resources x 1.35.9, 1.36.5, 1.37.1, -strict, offline: all valid)
chart-checks: trivy passed in 6s          (config, checks bundle trivy-checks:2.3.0@sha256:3eae4436..., HIGH,CRITICAL: none)
$ bash deploy/helm/openverify/ci/tests/chart-checks.test.sh   (rc 0) 47 passed
$ bash deploy/helm/openverify/ci/tests/kind.test.sh           (rc 0) 72 passed
$ bash deploy/helm/openverify/ci/tests/chart-policy.test.sh   (rc 0) 44 passed
$ HELM4=~/.local/bin/helm HELM3=~/.local/bin/helm3 bash infra/tests/chart-skeleton.test.sh   (rc 0) 51 passed
$ pnpm format:check      (rc 0, 117 s, load 1.65)
```
Earlier on this tree's way: security/python's whole pytest 189 passed at 97.12% (the script 97%), ruff check and format clean, mypy --strict clean (section 9).

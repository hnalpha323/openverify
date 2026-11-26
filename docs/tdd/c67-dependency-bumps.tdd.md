# C67: date-gated dependency work

Each item is applied between Workflows, once its date has passed. A version is never taken younger than 14 days without decision 30.

| Item | State |
|---|---|
| PDFium CVE record | done 2026-10-31 |
| nodemailer 10.0.15 to 10.1.6 | done 2026-11-01 (10.1.7 was not yet 14 days old in the gap) |
| pypdf 6.19.0 to 6.21.2 | from 2026-11-04T16:45Z, in the first gap after that (6.21.4 from 2026-11-11T17:01Z) |
| pypdfium2 past PDFium 8125 | no qualifying release yet. It also needs the owner's answer on HarfBuzz's "Old MIT" licence |

## 2026-10-31: the PDFium CVE record

The record said build 8076 was "treated as not fixed" for CVE-2026-113022. A re-check on 2026-10-30 matched each CVE to a public PDFium commit through the Chromium issue id NVD cites: 8076 carries that fix, and lacks two others (CVE-2026-110155 in AGG, and CVE-2026-118345 in OpenJPEG, High). `chromium/8125` is the first build with all three.

RED (`f32c24d0`), `test_the_installed_pdfium_is_the_build_the_cve_record_names` gains the new needles:

```text
$ uv run pytest tests/test_dependencies.py -q --no-cov -k cve_record
E           AssertionError: CVE-2026-110155
tests/test_dependencies.py:132: AssertionError
1 failed, 8 deselected in 0.09s
```

GREEN (`59b75b31`), `THIRD_PARTY_LICENSES.md` and `docs/checks/document.md`:

```text
$ uv run pytest tests/test_dependencies.py -q --no-cov
9 passed in 0.18s
$ pnpm exec prettier --check THIRD_PARTY_LICENSES.md docs/checks/document.md .github/workflows/ci.yml
All matched files use Prettier code style!
```

Both PDFium gaps stay open behind the guarded child (C60.2) until a pypdfium2 release carries 8125 or later.

## 2026-11-01: nodemailer 10.0.15 to 10.1.6

The gap after Workflow 7B fell at about 15:15Z, between 10.1.6 clearing 14 days (12:55:03Z) and 10.1.7 (18:24:51Z), so 10.1.6 is taken: it holds 10.1.4's nine addressparser fixes behind GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h, and 10.1.7 adds only a mime-funcs encoding fix. The usage (`createTransport({ url, ...timeouts })`, `sendMail` with `{ address }` recipients) is unchanged API.

RED (`5aba8ce8`), the new `apps/api/src/mail/dependencies.test.ts`: the pin, one locked version, and the parser behind `from` yielding no `evil.com` mailbox for the advisories' payloads:

```text
$ pnpm exec vitest run src/mail/dependencies.test.ts --coverage.enabled=false
AssertionError: expected '10.0.15' to be '10.1.6'
AssertionError: expected [ '10.0.15' ] to deeply equal [ '10.1.6' ]
AssertionError: expected [ 'evil.com' ] to not include 'evil.com'      (4 payloads)
Tests  6 failed (6)
```

GREEN (`a973e6ea`): `apps/api/package.json`, `pnpm-lock.yaml` (5 lines; integrity `sha512-8j/UEmA4...` equals the registry's), the licence row. Then `256d29af` (lint and format of the test):

```text
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile     Done
$ pnpm exec vitest run src/mail --coverage.enabled=false             Tests  20 passed (20)
$ (packages/checks) vitest run src/contact/email-destination.test.ts Tests  45 passed (45)
$ (apps/api) pnpm run typecheck                                       rc 0
```

The full-stack Mailpit specs and the apps image are re-run with the closing validation of Workflow 7B (`docs/tdd/phase7-orchestrator.tdd.md`). 10.1.7 and the 10.2/10.3 feature releases can follow under the normal 14-day rule.

# The open-source release: README, community files, illustrations, the public repository (TDD evidence)

Orchestrator: Claude Code session d1064829 (claude-opus-5-5), on the owner's instruction of 2026-11-25: "Prepare nice readmes , screenshots, illustrations and make it available to everyone. make it opensource and follow all conventions and good practices". The owner's decisions for it: a new public repository with a fresh, squashed history under the GitHub noreply address (the private history kept as an archive, because every commit of it carries a personal address); Workflow 12A's commits published with it; the repository made public at once; GitHub-only contact (no address published).

## The security pages once the repository is public (C276.4, Q1, REL-VISIBILITY)

`SECURITY.md` and `docs/security/vulnerability-policy.md` said the repository "stays private until the public release", and the records rule (`packages/docs-tools/src/records/vulnerability-policy.ts`, `q1Findings`) required that wording while Q1 is granted. The rule had no state for the release step done, so it now reads the release checklist: with `REL-VISIBILITY` `done`, a page must say the repository is public and must no longer say it stays private.

RED (`packages/docs-tools/src/records/vulnerability-policy.test.ts`, four new cases):

```text
$ (packages/docs-tools) pnpm exec vitest run src/records/vulnerability-policy.test.ts --coverage.enabled=false
       × fails a SECURITY.md that still says the repository is private until the release
       × fails a SECURITY.md that does not say the repository is public
       × passes a SECURITY.md that says the repository is public and the channel open
      Tests  3 failed | 12 passed (15)
```

The third failed on the old rule's "private until" requirement; the fourth (the line still the owner's) passed, as it should.

GREEN: `repositoryMadePublic(repo)` (the checklist's `REL-VISIBILITY` line `done`) and its branch in `q1Findings`:

```text
$ (packages/docs-tools) pnpm exec vitest run src/records/vulnerability-policy.test.ts --coverage.enabled=false
      Tests  15 passed (15)
```

Then the pages: `SECURITY.md` (the direct form link, what a report needs, the open channel), the policy's channel paragraph, and the checklist's `REL-VISIBILITY` line `done` (2026-11-25), with `docs/release/notes.md` re-rendered (commit `583aa10e9`).

```text
$ pnpm --filter @openverify/docs-tools docs:all
$ pnpm --filter @openverify/docs-tools test
 Test Files  51 passed (51)
      Tests  448 passed (448)      97.75 / 86.55 / 98.57 / 97.76
$ pnpm --filter @openverify/docs-tools typecheck; eslint src/records/vulnerability-policy*.ts   # exit 0
$ pnpm release:check
release:check (default): 0 errors, 62 owner items      # 63 before: REL-VISIBILITY closed
```

## Documentation and community files

- `README.md` rewritten: the logo, what OpenVerify does, the features by area (figures from the generated catalog: 89 checks, 11 report types, 19 signals), how a verification works, the architecture, the quick start from `docs/self-hosting/install-compose.md`, a first inquiry with `@openverify/node` (from its README), the project's status as the release notes state it, the documentation index, licences and acknowledgements (DB-IP's CC BY 4.0 attribution among them). Two claims were cut while checking it against the code: "nothing calls home" (the Android face module's ONNX Runtime telemetry is not measured on a device yet) and production use by anyone.
- `CONTRIBUTING.md` (setup, the gates, the project's six rules from `CLAUDE.md`, conventions, Conventional Commits with DCO sign-off, documentation assets), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, the official text with the private reporting form as its contact), `SUPPORT.md`, `CHANGELOG.md` (Keep a Changelog, `Unreleased`), `.github/ISSUE_TEMPLATE/` (bug and feature forms that refuse personal data; blank issues off; security and questions routed away), `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`.
- `docs/assets/`: the logo (light, dark, mark) and two illustrations, the architecture and a verification's five steps, each in a light and a dark variant chosen by `<picture>`. They were rendered with Playwright's Chromium on both backgrounds and checked by eye; the first render's overlaps (the webhook label, the data-store heading, the last card's margin) were fixed.
- `docs/assets/screenshots/` and `e2e/tests/docs-screenshots.spec.ts`: `docs/tdd/release-docs-screenshots.tdd.md`.

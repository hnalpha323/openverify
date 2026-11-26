## What and why

<!-- What does this change, and why? Link the issue it resolves: "Closes #123". -->

## How it was tested

<!-- The commands you ran and what they showed. For a behaviour change: the failing test first (RED), then green. -->

## Checklist

- [ ] A failing test came first, and coverage stays at 80% or more for each package touched.
- [ ] `pnpm format:check`, `pnpm lint` and `pnpm typecheck` pass, plus the gates of anything else touched (vision, Android, e2e).
- [ ] No real personal data, secrets or tokens in the code, fixtures, logs or screenshots.
- [ ] New dependencies are permissively licensed, pinned and at least 14 days old.
- [ ] A heuristic check is `beta` with a confidence score, and its documentation says what it does not detect.
- [ ] Documentation and generated documents are updated (`pnpm --filter @openverify/docs-tools docs:all` if a check, report or route changed).
- [ ] `CHANGELOG.md` has a line under **Unreleased** for a user-visible change.
- [ ] Commits follow Conventional Commits and are signed off (`git commit -s`).

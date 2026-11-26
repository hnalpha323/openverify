/**
 * C274.6 in `pnpm release:check` (Workflow 11E, Stage 3; owner `integration-11e`, from
 * docs-security's contract deviation): the release check with the checklists' staleness folded
 * in, read through an injected {@link EvidenceHistory} so no test reads the working tree's HEAD.
 * A stale row is an `owner` finding: the default mode reports it and exits 0, `--tag` refuses it.
 * The CLI's `main()` passes the git history of the real tree.
 */
import {
  RELEASE_CHECK_DEPS,
  runReleaseCheck,
  type ReleaseCheckOptions,
  type ReleaseCheckResult,
} from '../release/index.js';
import { checkSecurityWith, type EvidenceHistory } from '../security/index.js';
import type { Repository } from '../types.js';

/** The release check that also reports stale checklist rows, from `history`. */
export const staleAwareReleaseCheck: (
  history: EvidenceHistory,
) => (repo: Repository, options: ReleaseCheckOptions) => ReleaseCheckResult =
  (history) => (repo, options) =>
    runReleaseCheck(repo, options, {
      ...RELEASE_CHECK_DEPS,
      security: (target) => checkSecurityWith(target, { history }),
    });

/**
 * C284.2: `pnpm release:check` (docs-release; reviews F16, H14, H17, H19, H20, H21, H25;
 * verification V01). It runs every machine-checkable rule of the release checklist in one of two
 * modes:
 * - **default** (every Validation's gate from 11E on): an `error` is a rule an agent can satisfy
 *   and fails the run; an `owner` finding is an item only the owner, the orchestrator or a later
 *   Workflow closes, reported with its state, and the run exits 0 while only those remain;
 * - **`--tag`** (the owner's tag step only): every `owner` finding fails it too, and every checklist
 *   line that is not `done` is one.
 * A confirmed CRITICAL or HIGH that is not fixed is an `error`, so it fails both modes.
 *
 * The script checks that evidence exists and agrees, not that it is sufficient (C284.3).
 */
import { checkSecurity } from '../security/index.js';
import type { CheckFinding, CheckResult, Repository } from '../types.js';
import { calibrationFindings } from './calibration.js';
import { CHECKLIST_PATH, checkChecklist, parseChecklist, type Checklist } from './checklist.js';
import { deferralFindings } from './deferrals.js';
import { gapFindings } from './gaps.js';
import { licenceFindings } from './licences.js';
import { PROGRESS_PATH, OWNER_ITEMS, ownerStates, type OwnerItem } from './progress.js';
import { mediumFindings, verifierFindings } from './review.js';
import { notesFindings } from './notes.js';
import { modelsManifestFindings, stagedFindings } from './staged.js';
import { versionFindings } from './versions.js';

/** C284.2's two modes: the default (the gate of 11E-11G) and `--tag` (the owner's tag step). */
export interface ReleaseCheckOptions {
  readonly tag: boolean;
}

/** What `release:check` found: `error` findings fail it; `owner` findings fail only `--tag`. */
export interface ReleaseCheckResult extends CheckResult {
  readonly mode: 'default' | 'tag';
}

/** The checks release:check folds in that other areas own, injected so a fixture can stand in. */
export interface ReleaseCheckDeps {
  /** docs-security's threat-model, ASVS and MASVS checks (C273.4, C274.3, C275.3). */
  readonly security: (repo: Repository) => readonly CheckResult[];
  /** The release notes' own rules (fresh render, required disclosures); docs-release's. */
  readonly notes: (repo: Repository) => readonly CheckFinding[];
}

/** The text a checklist line must hold to depend on the P2 exception (H20). */
export const P2_DEPENDENCY = /depends on (?:Phase 10 P2|Phase 4 decision 11)/;

/** Folds another area's check results into release:check's findings. */
export function securityFindings(results: readonly CheckResult[]): readonly CheckFinding[] {
  return results.flatMap((result): CheckFinding[] =>
    result.status === 'not-built'
      ? [
          {
            rule: 'security',
            path: 'docs/security/',
            message: `${result.name}: not built yet (docs-security): the threat model, ASVS and MASVS checks must pass (C284.2)`,
            severity: 'error',
          },
        ]
      : result.findings.map((finding) => ({ ...finding, rule: `security/${finding.rule}` })),
  );
}

/** Q1-Q12 and Phase 10 P1-P5 as PROGRESS records them, and P2's hold on the flow image. */
export function ownerStateFindings(
  repo: Repository,
  checklist: Checklist | null,
): readonly CheckFinding[] {
  const progress = repo.exists(PROGRESS_PATH) ? repo.readText(PROGRESS_PATH) : '';
  const states = ownerStates(progress);
  const findings: CheckFinding[] = [];
  for (const item of OWNER_ITEMS) {
    const recorded = states.get(item);
    const phase10 = item.startsWith('P');
    const label = phase10 ? `Phase 10 ${item}` : item;
    if (recorded === undefined) {
      findings.push({
        rule: 'owner-state',
        path: PROGRESS_PATH,
        message: phase10
          ? `orchestrator: PROGRESS records no state for ${label}: add "${item} <granted|declined|pending>" to Phase 10's row of the phase table`
          : `orchestrator: PROGRESS records no state for ${label}: add "**${item}:** <granted|declined|pending>" to the newest entry, or name ${item} in Phase 11's row of the phase table`,
        severity: 'owner',
      });
    } else if (recorded.state === 'pending') {
      findings.push({
        rule: 'owner-state',
        path: PROGRESS_PATH,
        line: recorded.line,
        message: `owner: ${label} is pending; C289's default holds and the release notes state its outcome`,
        severity: 'owner',
      });
    }
  }
  const p2: OwnerItem = 'P2';
  const p2State = states.get(p2)?.state ?? 'pending';
  if (p2State !== 'granted' && checklist !== null) {
    const shipsGuidance = checklist.facts.shippedFlowImage !== 'noguidance';
    if (shipsGuidance) {
      findings.push({
        rule: 'flow-image',
        path: CHECKLIST_PATH,
        message: `owner: the flow image with onnxruntime-web is the shipped one while Phase 10 P2 is ${p2State}: ship the -noguidance build (C289) or record P2's grant`,
        severity: 'owner',
      });
      for (const line of checklist.lines) {
        if (line.state === 'done' && P2_DEPENDENCY.test(line.text)) {
          findings.push({
            rule: 'p2-dependency',
            path: CHECKLIST_PATH,
            line: line.line,
            message: `${line.id} depends on Phase 10 P2 and reads done while P2 is ${p2State} and the release does not ship the decline outcome (H20)`,
            severity: 'error',
          });
        }
      }
    }
  }
  return findings;
}

/** The checklist's own lines: owner-dependent ones in the default mode, every line not done with --tag. */
export function lineStateFindings(
  checklist: Checklist | null,
  tag: boolean,
): readonly CheckFinding[] {
  if (checklist === null) {
    return [];
  }
  return checklist.lines
    .filter((line) => line.state !== 'done' && (tag || line.state !== 'open'))
    .map((line) => ({
      rule: 'checklist-state',
      path: CHECKLIST_PATH,
      line: line.line,
      message: `${line.id} is ${line.state} (${line.who})`,
      severity: 'owner' as const,
    }));
}

/** Every rule of C284.2, in the mode `options` names, with the other areas' checks injected. */
export function runReleaseCheck(
  repo: Repository,
  options: ReleaseCheckOptions,
  deps: ReleaseCheckDeps,
): ReleaseCheckResult {
  const checklist = repo.exists(CHECKLIST_PATH)
    ? parseChecklist(repo.readText(CHECKLIST_PATH))
    : null;
  const findings: CheckFinding[] = [
    ...checkChecklist(repo),
    ...securityFindings(deps.security(repo)),
    ...gapFindings(repo),
    ...ownerStateFindings(repo, checklist),
    ...versionFindings(repo, checklist?.facts.releaseVersion ?? null),
    ...deferralFindings(repo),
    ...licenceFindings(repo),
    ...calibrationFindings(repo),
    ...verifierFindings(repo),
    ...mediumFindings(repo),
    ...stagedFindings(repo),
    ...modelsManifestFindings(repo),
    ...deps.notes(repo),
    ...lineStateFindings(checklist, options.tag),
  ];
  return {
    name: 'release:check',
    mode: options.tag ? 'tag' : 'default',
    status: 'built',
    findings,
  };
}

/** The real dependencies: docs-security's checks and the release notes' rules. */
export const RELEASE_CHECK_DEPS: ReleaseCheckDeps = {
  security: checkSecurity,
  notes: notesFindings,
};

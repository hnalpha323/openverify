/**
 * C284.4: `docs/release/notes.md`, generated (docs-release; review H21, decision 75). Every line
 * comes from a record the repository holds: the checklist's states and facts, PROGRESS's owner
 * states, C289's table, the three 11D summary blocks (C269, C271, C272), the licence file's
 * pending rows, the Dockerfiles' runtime bases, the staged run's record (or "staged run pending"),
 * the network sources' attribution, the earlier phases' "defaults taken" lists and the Phase 10
 * close's device proofs. No clock is read: the date is the checklist's `As of`.
 *
 * {@link requiredDisclosures} lists what a contract sends to the notes; release:check fails when
 * the committed notes lack one (C284.2, H21), and when they differ from a fresh render.
 */
import { staleFiles } from '../fresh-render.js';
import { DOCS_SWITCHES } from '../switches.js';
import type { CheckFinding, GeneratedFile, Repository } from '../types.js';
import {
  isNotMet,
  readCalibrations,
  type CalibrationRow,
  type CalibrationSummary,
} from './calibration.js';
import { CHECKLIST_PATH, parseChecklist, type Checklist } from './checklist.js';
import { LICENCES_PATH, pendingLicenceRows, type PendingLicenceRow } from './licences.js';
import { splitRow } from './markdown.js';
import {
  OWNER_ITEMS,
  PROGRESS_PATH,
  defaultsTaken,
  ownerStates,
  type OwnerItem,
  type RecordedState,
} from './progress.js';
import { readStagedRun, type StagedRun } from './staged.js';

export const NOTES_PATH = 'docs/release/notes.md';
export const PHASE_11_PLAN = 'docs/plans/phase-11.plan.md';
export const NETWORK_SOURCES = 'network/sources.json';
export const DEBIAN_SOURCES = 'https://snapshot.debian.org/';
/** The Dockerfiles whose runtime base each image ships (as `release.yml`'s stage job lists them). */
export const IMAGE_DOCKERFILES: readonly { readonly image: string; readonly path: string }[] = [
  { image: 'openverify/api', path: 'infra/docker/api.Dockerfile' },
  { image: 'openverify/dashboard', path: 'infra/docker/dashboard.Dockerfile' },
  { image: 'openverify/flow', path: 'infra/docker/flow.Dockerfile' },
  { image: 'openverify/code-runner', path: 'infra/docker/code-runner.Dockerfile' },
  { image: 'openverify/vision', path: 'services/vision/Dockerfile' },
];

/** One row of C289's table: the item, what is built meanwhile, the switch and the decline outcome. */
export interface OwnerOutcome {
  readonly item: string;
  readonly built: string;
  readonly granted: string;
  readonly declined: string;
}

/** Everything the notes are rendered from. */
export interface NotesInputs {
  readonly checklist: Checklist;
  readonly states: ReadonlyMap<OwnerItem, RecordedState>;
  readonly outcomes: readonly OwnerOutcome[];
  readonly summaries: readonly CalibrationSummary[];
  readonly licences: readonly PendingLicenceRow[];
  readonly bases: readonly {
    readonly image: string;
    readonly path: string;
    readonly base: string;
  }[];
  readonly staged: StagedRun | null;
  readonly attribution: { readonly text: string; readonly link: string } | null;
  readonly defaults: readonly string[];
  readonly deviceProofs: readonly string[];
  readonly publishWired: boolean;
}

/** C289's table, read from the plan (`| Item | Built in 11A–11F | ... | If declined |`). */
export function ownerOutcomes(planText: string): readonly OwnerOutcome[] {
  const lines = planText.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Item | Built in 11A'));
  if (start < 0) {
    return [];
  }
  const outcomes: OwnerOutcome[] = [];
  for (const line of lines.slice(start + 2)) {
    const cells = splitRow(line);
    if (cells === null) {
      break;
    }
    outcomes.push({
      item: cells[0] ?? '',
      built: cells[1] ?? '',
      granted: cells[3] ?? '',
      declined: cells[4] ?? '',
    });
  }
  return outcomes;
}

/** The runtime base of each image (`ARG NODE_IMAGE=` or `ARG PYTHON_IMAGE=`), as `release.yml` lists them. */
export function runtimeBases(
  repo: Repository,
): readonly { readonly image: string; readonly path: string; readonly base: string }[] {
  return IMAGE_DOCKERFILES.flatMap(({ image, path }) => {
    if (!repo.exists(path)) {
      return [];
    }
    return repo
      .readText(path)
      .split('\n')
      .filter((line) => line.startsWith('ARG NODE_IMAGE=') || line.startsWith('ARG PYTHON_IMAGE='))
      .map((line) => ({ image, path, base: line.slice(line.indexOf('=') + 1).trim() }));
  });
}

/** The Phase 10 close's "device proof open" lines (PROGRESS, "Unproved on a device or an emulator"). */
export function deviceProofs(progressText: string): readonly string[] {
  const lines = progressText.split('\n');
  const start = lines.findIndex((line) => line === '### Unproved on a device or an emulator');
  if (start < 0) {
    return [];
  }
  const proofs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) {
      break;
    }
    if (line.startsWith('- device proof open: ')) {
      proofs.push(line.slice('- device proof open: '.length).trim());
    }
  }
  return proofs;
}

function attributionOf(repo: Repository): { text: string; link: string } | null {
  if (!repo.exists(NETWORK_SOURCES)) {
    return null;
  }
  const data = JSON.parse(repo.readText(NETWORK_SOURCES)) as {
    sources?: { attribution?: unknown; link_back?: unknown; enabled_by_default?: unknown }[];
  };
  const source = (data.sources ?? []).find(
    (entry) => typeof entry.link_back === 'string' && entry.enabled_by_default === true,
  );
  return source === undefined
    ? null
    : { text: String(source.attribution), link: String(source.link_back) };
}

/** Reads every input of the notes; `null` when the checklist does not exist. */
export function readNotesInputs(repo: Repository): NotesInputs | null {
  if (!repo.exists(CHECKLIST_PATH)) {
    return null;
  }
  const progress = repo.exists(PROGRESS_PATH) ? repo.readText(PROGRESS_PATH) : '';
  const staged = readStagedRun(repo);
  return {
    checklist: parseChecklist(repo.readText(CHECKLIST_PATH)),
    states: ownerStates(progress),
    outcomes: repo.exists(PHASE_11_PLAN) ? ownerOutcomes(repo.readText(PHASE_11_PLAN)) : [],
    summaries: readCalibrations(repo).summaries,
    licences: repo.exists(LICENCES_PATH) ? pendingLicenceRows(repo.readText(LICENCES_PATH)) : [],
    bases: runtimeBases(repo),
    staged: typeof staged === 'string' ? null : staged,
    attribution: attributionOf(repo),
    defaults: defaultsTaken(progress).map((item) => item.text),
    deviceProofs: deviceProofs(progress),
    publishWired: DOCS_SWITCHES.publishWired,
  };
}

/** A figure as the notes print it: grouped integers, one decimal from 100 up, four digits below. */
export function formatFigure(value: number): string {
  if (Number.isInteger(value)) {
    const digits = String(Math.abs(value));
    const groups: string[] = [];
    for (let end = digits.length; end > 0; end -= 3) {
      groups.unshift(digits.slice(Math.max(0, end - 3), end));
    }
    return `${value < 0 ? '-' : ''}${groups.join(',')}`;
  }
  return Math.abs(value) >= 100 ? value.toFixed(1) : String(Number(value.toPrecision(4)));
}

const signed = (value: number): string => `${value > 0 ? '+' : ''}${formatFigure(value)}`;

/** One calibration row as a sentence: its title, verdict, figure, budget and gap. */
export function rowSentence(row: CalibrationRow): string {
  const parts = [`\`${row.id}\` (${row.contract}): ${row.title}: **${row.verdict}**`];
  if (row.median !== null) {
    parts.push(`${formatFigure(row.median)} ${row.unit ?? ''}`.trim());
  }
  if (row.budget !== null) {
    parts.push(
      `budget ${row.budget.metric} ${row.budget.comparison} ${formatFigure(row.budget.value)} ${row.budget.unit}`,
    );
  }
  if (row.gap !== null) {
    parts.push(`gap ${signed(row.gap)}`);
  }
  return `${parts.join('; ')} (${row.configuration})`;
}

const stateWords = (state: RecordedState | undefined): string =>
  state === undefined ? 'not recorded in PROGRESS' : state.words;

/** The disclosures a contract sends to the notes, each as text the notes must hold. */
export interface Disclosure {
  readonly id: string;
  readonly contract: string;
  readonly text: string;
}

const UNSIGNED =
  'No artifact of this release is signed or attested, and nothing is published: the publish job of `.github/workflows/release.yml` is written but runs only when the owner sets `OPENVERIFY_PUBLISH` in the `release` environment (Q1-Q3).';
const PUBLISH_WIRED =
  "No artifact of this release is signed, attested or published yet. `.github/workflows/release.yml`'s publish job is wired (Q1-Q4 granted, Workflow 11G): it runs only when the owner sets `OPENVERIFY_PUBLISH` and the `release` environment's reviewer approves the run, a dispatch is a dry run unless its `dry-run` input is false, and a staged `pending-owner` artifact stops the whole publication. The first approved dispatch with `dry-run` false will push each image by digest to the owner's GHCR namespace, sign it keyless with cosign and attest its SBOM, push the chart as an OCI artifact, write build provenance for every staged file and pushed digest, and publish `@openverify/js`, `@openverify/node` and `@openverify/react` with npm provenance. Staged workflow artifacts stay unsigned; `docs/self-hosting/verify-artifacts.md` gives the checks.";
const STAGED_PENDING =
  'Staged run pending: `release.yml` has never been dispatched (KP10-59), so no image digest, `SHA256SUMS` or SBOM licence report of a staged run exists yet. Local builds are never release artifacts.';
const SFACE =
  "SFace's licence review is open (Q6): the model weights are fetched at start from `models/manifest.json`'s pinned URLs and checked by SHA-256, and no image carries them.";
const CONSENT_TEXTS =
  'The built-in `share.consent.*` texts are not reviewed by counsel (Q7, C238.10): they carry the review status `counsel-unreviewed`, and publishing a flow that uses them needs the acknowledgement `share-consent-default-text`.';
const LIST_CAP =
  'A list whose fuzzy-name candidates exceed the cap is answered `unscreened` with the reason `limit_exceeded`, never as "no match".';
const NETWORK_DATA =
  "Network data is the operator's own sync (`network:sync`, or the worker's `network-refresh` job): no network database is baked into an image (ADR 0006).";

/** Every disclosure the inputs require (C284.4; the release checklist's notes line). */
export function requiredDisclosures(inputs: NotesInputs): readonly Disclosure[] {
  const list: Disclosure[] = [];
  if (inputs.publishWired) {
    list.push({ id: 'publish-wired', contract: 'C262, C285, C289 (Q1-Q4)', text: PUBLISH_WIRED });
  } else {
    list.push({ id: 'unsigned', contract: 'C262.4, C289 (Q1-Q3)', text: UNSIGNED });
  }
  if (inputs.staged === null) {
    list.push({ id: 'staged-run', contract: 'C262.4, C257.5', text: STAGED_PENDING });
  }
  list.push({ id: 'base-sources', contract: 'C257.5', text: DEBIAN_SOURCES });
  for (const base of inputs.bases) {
    list.push({ id: `base:${base.path}`, contract: 'C257.5', text: base.base });
  }
  for (const item of OWNER_ITEMS) {
    list.push({ id: `owner:${item}`, contract: 'C289', text: `**${ownerLabel(item)}**` });
  }
  for (const summary of inputs.summaries) {
    for (const row of summary.rows.filter(isNotMet)) {
      list.push({
        id: `calibration:${row.id}`,
        contract: 'C271.4, C284.4',
        text: rowSentence(row),
      });
    }
  }
  list.push({ id: 'sface', contract: 'C289 (Q6)', text: SFACE });
  list.push({ id: 'consent-texts', contract: 'C238.10', text: CONSENT_TEXTS });
  list.push({ id: 'list-cap', contract: 'owner decision 4 after 7B', text: LIST_CAP });
  list.push({ id: 'network-data', contract: 'Workflow 7A', text: NETWORK_DATA });
  if (inputs.attribution !== null) {
    list.push({
      id: 'db-ip',
      contract: 'Workflow 7A',
      text: `${inputs.attribution.text} (${inputs.attribution.link})`,
    });
  }
  for (const row of inputs.licences) {
    list.push({ id: `licence:${String(row.line)}`, contract: 'H19', text: row.component });
  }
  for (const line of inputs.checklist.lines.filter((entry) => entry.id === 'KP11-39')) {
    list.push({ id: 'KP11-39', contract: 'KP11-39', text: line.text });
  }
  for (const text of inputs.defaults) {
    list.push({ id: 'defaults-taken', contract: 'earlier phases', text });
  }
  for (const text of inputs.deviceProofs) {
    list.push({ id: 'device-proof', contract: 'rule 25', text });
  }
  return list;
}

const ownerLabel = (item: OwnerItem): string => (item.startsWith('P') ? `Phase 10 ${item}` : item);

function ownerSection(inputs: NotesInputs): string[] {
  const out = [
    '## Owner decisions and their outcomes (C289)',
    '',
    "Each item's state is PROGRESS's (Q1-Q12 in the newest entry's `**Qn:**` lines and Phase 11's row of the phase table, Phase 10's P1-P5 in its row, decided on 2026-11-08 by the orchestrator under the owner's delegation). A granted item shows what is built under its grant (its checklist line) and what the release becomes if the owner reverses it; a pending item ships what is built meanwhile, and its decline outcome is what the release becomes if the owner declines it.",
    '',
  ];
  for (const item of OWNER_ITEMS.filter((id) => id.startsWith('Q'))) {
    const outcome = inputs.outcomes.find((row) => row.item.startsWith(`${item} `));
    const recorded = inputs.states.get(item);
    const state = stateWords(recorded);
    const line = inputs.checklist.lines.find((entry) => entry.id === item);
    if (outcome === undefined) {
      out.push(`- **${item}**: ${state}.`);
    } else if (recorded?.state === 'declined' && line !== undefined) {
      out.push(
        `- **${item}** (${outcome.item.slice(item.length + 1)}): ${state}. The release ships the decline outcome: ${outcome.declined}. Built: ${line.text}.`,
      );
    } else if (recorded?.state === 'granted' && line !== undefined) {
      out.push(
        `- **${item}** (${outcome.item.slice(item.length + 1)}): ${state}. Built under the grant: ${line.text}. If the owner reverses it: ${outcome.declined}.`,
      );
    } else {
      out.push(
        `- **${item}** (${outcome.item.slice(item.length + 1)}): ${state}. Built meanwhile: ${outcome.built}. If declined: ${outcome.declined}.`,
      );
    }
  }
  const p2 = inputs.outcomes.find((row) => row.item.startsWith('Phase 10 P2'));
  for (const item of OWNER_ITEMS.filter((id) => id.startsWith('P'))) {
    const line = inputs.checklist.lines.find((entry) => entry.id === `P10-${item}`);
    const state = stateWords(inputs.states.get(item));
    out.push(`- **${ownerLabel(item)}**: ${state}.${line === undefined ? '' : ` ${line.text}.`}`);
  }
  const image = inputs.checklist.facts.shippedFlowImage;
  const p2State = inputs.states.get('P2')?.state;
  out.push(
    '',
    image === 'noguidance'
      ? 'The flow image shipped is the build without `onnxruntime-web` (`OPENVERIFY_FLOW_FACE_GUIDANCE=off`): on-device face guidance is off in the web flow (C289).'
      : `The flow image shipped carries \`onnxruntime-web\` (on-device face guidance) while Phase 10 P2 stays ${p2State === 'granted' ? 'granted narrowly' : (p2State ?? 'unrecorded')}; the build without it is tested and becomes the release's if the owner reverses P2${p2 === undefined ? '' : ` (${p2.declined})`}.`,
    '',
  );
  return out;
}

function calibrationSection(inputs: NotesInputs): string[] {
  const out = [
    '## Performance and calibration (C269, C271, C272)',
    '',
    'Read from the summary blocks of the three Workflow 11D reports, never re-judged. A figure is the median of its valid takes on the machine below; each take and its load average are in the report.',
    '',
  ];
  for (const summary of inputs.summaries) {
    const machine = summary.machine;
    out.push(
      `### \`${summary.report}\``,
      '',
      machine === null
        ? 'Machine: not recorded.'
        : `Machine: ${machine.cpu}, ${String(machine['logical-cpus'])} logical CPUs, ${formatFigure(machine['memory-gib'])} GiB, ${machine['disk-class']}; head \`${summary.head ?? 'not recorded'}\`.`,
      '',
    );
    const groups: readonly [string, (row: CalibrationRow) => boolean][] = [
      ['Missed, each with its gap', (row) => row.verdict === 'missed'],
      ['Not measured', (row) => row.verdict === 'not-measured'],
      ['Invalid (the takes broke a validity rule)', (row) => row.verdict === 'invalid'],
      ['Not calibrated', (row) => row.verdict === 'not-calibrated'],
      ['Reverted or shipped off', (row) => row.verdict === 'revert'],
      [
        'Settings and figures for the operator',
        (row) => row.verdict === 'reported' && /^C272|owner decision/.test(row.contract),
      ],
    ];
    for (const [title, test] of groups) {
      const rows = summary.rows.filter(test);
      if (rows.length === 0) {
        continue;
      }
      out.push(`${title}:`, '', ...rows.map((row) => `- ${rowSentence(row)}`), '');
    }
  }
  const owners = inputs.checklist.lines.filter((line) =>
    ['KP11-63', 'KP11-64', 'KP11-65'].includes(line.id),
  );
  if (owners.length > 0) {
    out.push(
      "The owner's questions Workflow 11D left:",
      '',
      ...owners.map((line) => `- ${line.id}: ${line.text}.`),
      '',
    );
  }
  return out;
}

function stateCounts(checklist: Checklist): string {
  const counts = new Map<string, number>();
  for (const line of checklist.lines) {
    counts.set(line.state, (counts.get(line.state) ?? 0) + 1);
  }
  return ['done', 'open', 'owner', 'ci-pending']
    .map((state) => `${String(counts.get(state) ?? 0)} ${state}`)
    .join(', ');
}

/** The notes' Markdown. */
export function renderNotes(inputs: NotesInputs): string {
  const { checklist } = inputs;
  const version = checklist.facts.releaseVersion ?? 'unset';
  const asOf = checklist.facts.asOf ?? 'unset';
  const notDone = checklist.lines.filter((line) => line.state !== 'done');
  const out: string[] = [
    `# Release notes: OpenVerify ${version}`,
    '',
    `Generated by \`pnpm --filter @openverify/docs-tools docs:release\` from the release checklist, PROGRESS, the plan's C289 table, the Workflow 11D summary blocks, \`THIRD_PARTY_LICENSES.md\`, the Dockerfiles and \`network/sources.json\` (C284.4); do not edit it by hand. As of ${asOf}, the checklist's date. Nothing here is tagged: the owner tags the release after \`pnpm release:check --tag\` passes.`,
    '',
    'This release ships the web platform and Android. No iOS code, app or artifact ships in it: the shared Kotlin code is compiled for the iOS targets to stay iOS-ready, untested on iOS and unpublished.',
    '',
    '## Status',
    '',
    `The checklist holds ${String(checklist.lines.length)} lines: ${stateCounts(checklist)}. Every line that is not done:`,
    '',
    ...notDone.map((line) => `- \`${line.id}\` (${line.state}; ${line.who}): ${line.text}`),
    '',
    '## Artifacts, signatures and sources (C257.5, C262.4)',
    '',
    ...(inputs.publishWired ? [PUBLISH_WIRED, ''] : [UNSIGNED, '']),
    ...(inputs.staged === null
      ? [STAGED_PENDING, '']
      : [
          `Staged run ${inputs.staged.runId} on \`${inputs.staged.commit}\` (${inputs.staged.date}). Check each file against its SHA-256:`,
          '',
          ...inputs.staged.artifacts.map(
            (artifact) => `- \`${artifact.path}\`: \`${artifact.sha256}\``,
          ),
          '',
          'Image digests:',
          '',
          ...inputs.staged.images.map((image) => `- \`${image.name}\`: \`${image.digest}\``),
          '',
        ]),
    `The images redistribute their base distribution's packages, some under the GPL, as aggregation beside OpenVerify's code (not legal advice); each image's SBOM lists them, and the Debian source of each listed version is at ${DEBIAN_SOURCES}. The runtime bases, pinned by digest:`,
    '',
    ...inputs.bases.map((base) => `- \`${base.image}\` (\`${base.path}\`): \`${base.base}\``),
    '',
    SFACE,
    '',
    ...ownerSection(inputs),
    '## Licences pending the owner (H19)',
    '',
    'Each row of `THIRD_PARTY_LICENSES.md` that reads "owner to confirm" or "pending":',
    '',
    ...inputs.licences.map((row) => `- ${row.component}: ${row.words}.`),
    ...checklist.lines
      .filter((line) => line.id === 'KP11-39')
      .map((line) => `- KP11-39: ${line.text}.`),
    '',
    ...calibrationSection(inputs),
    '## Lists (owner decisions 3 and 4 after Workflow 7B)',
    '',
    'The list thresholds and the cap stay provisional, each with its basis in `docs/calibration/lists-phase11.md` (the rows above). The face and background thresholds gate general availability (owner decision 3 after 7B).',
    '',
    LIST_CAP,
    '',
    '## Network data (Workflow 7A)',
    '',
    NETWORK_DATA,
    ...(inputs.attribution === null
      ? []
      : [
          `The default sources include DB-IP Lite: ${inputs.attribution.text} (${inputs.attribution.link}), under CC BY 4.0; a page that shows a result credits DB-IP and links back.`,
        ]),
    '',
    '## Consent texts (C238.10)',
    '',
    CONSENT_TEXTS,
    '',
    '## Device proofs open (the Phase 10 close; none new in Workflows 11A to 11D)',
    '',
    'No emulator runs on the build host and no CI run is counted on (KP10-59). Each line stays open until a device or an emulator runs it:',
    '',
    ...inputs.deviceProofs.map((text) => `- ${text}`),
    '',
    '## Owner items of earlier phases with their defaults taken',
    '',
    'PROGRESS\'s "Owner items (defaults taken; nothing blocks)" lists, as recorded; none refuses the tag:',
    '',
    ...inputs.defaults.map((text) => `- ${text}`),
    '',
  ];
  return `${out.join('\n').trimEnd()}\n`;
}

/** The release area's generated file. */
export function renderNotesFile(repo: Repository): GeneratedFile | null {
  const inputs = readNotesInputs(repo);
  return inputs === null ? null : { path: NOTES_PATH, content: renderNotes(inputs) };
}

/** C284.2's notes rules: the committed notes equal a fresh render and hold every disclosure. */
export function notesFindings(repo: Repository): readonly CheckFinding[] {
  const inputs = readNotesInputs(repo);
  if (inputs === null) {
    return [];
  }
  const file: GeneratedFile = { path: NOTES_PATH, content: renderNotes(inputs) };
  const findings: CheckFinding[] = staleFiles(repo, [file]).map((stale) => ({
    rule: 'notes-fresh',
    path: NOTES_PATH,
    message:
      stale.reason === 'missing'
        ? 'the release notes do not exist: run pnpm --filter @openverify/docs-tools docs:release'
        : 'the release notes differ from a fresh render: run pnpm --filter @openverify/docs-tools docs:release',
    severity: 'error',
  }));
  if (!repo.exists(NOTES_PATH)) {
    return findings;
  }
  const committed = repo.readText(NOTES_PATH);
  for (const disclosure of requiredDisclosures(inputs)) {
    if (!committed.includes(disclosure.text)) {
      findings.push({
        rule: 'notes-disclosure',
        path: NOTES_PATH,
        message: `the notes lack the disclosure ${disclosure.id} (${disclosure.contract}): "${disclosure.text.slice(0, 100)}"`,
        severity: 'error',
      });
    }
  }
  return findings;
}

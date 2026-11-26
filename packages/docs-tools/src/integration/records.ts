/**
 * C282 (Workflow 11E, Stage 3; owner `integration-11e`): the record test of the corrected records,
 * ADR 0010 final, PLAN (decision 47), `THIRD_PARTY_LICENSES.md`, the surface index's Connect rows,
 * the Phase 5 section 8 addendum and the Phase 6 C88 note. Each is hand-written, so a record test
 * holds the entries C282 demands (rule 21), the 11E decisions' items 8 and 19 and KP11-51.
 *
 * It checks that each correction is present and worded as a record, not that it is sufficient:
 * the review of each record is the owner's.
 */
import type { CheckFinding, CheckResult, Repository } from '../types.js';

/** The records C282 corrects, by role. */
export const CORRECTED_RECORDS = {
  plan: 'docs/PLAN.md',
  adr: 'docs/adr/0010-connect-release-hardening-and-deployment.md',
  licences: 'THIRD_PARTY_LICENSES.md',
  surface: 'docs/research/persona-surface.md',
  nfc: 'docs/research/phase5-nfc.md',
  phase6: 'docs/plans/phase-6.plan.md',
} as const;

type RecordRole = keyof typeof CORRECTED_RECORDS;

/** C286's next-release items PLAN's new section names (C282, review H25), and the address key (11E amendment 10). */
export const NEXT_RELEASE_ITEMS: readonly string[] = [
  'two installs',
  'SAML',
  'SCIM',
  'KMS',
  'arm64',
  'wallet',
  'withdrawal link',
  'video',
  '/metrics',
  'per-country',
];

/** The two earlier "Next release" sections, kept beside the new one and never merged into it. */
const EARLIER_NEXT_RELEASE = [
  '### Next release: carried owner items (Phase 9 C176, review H30)',
  '### Next release: iOS',
];

/** The C258.3 tools whose row in the licence file's section 1 carries a release date. */
export const DATED_TOOLS: readonly string[] = [
  'Trivy',
  'osv-scanner',
  'Grype',
  'Syft',
  'zizmor',
  'vegeta',
  'pip-audit',
  'gitleaks',
  'cosign',
  'Helm',
  'helm-unittest',
  'kubeconform',
  'chart-testing',
  'kind',
  'kubectl',
  'eslint-plugin-security',
  'CycloneDX Gradle plugin',
];

/** The eight event names the machine index missed (connect correction 1). */
export const MISSED_EVENTS: readonly string[] = [
  'connect/share-token.outbound-created',
  'connect/share-token.outbound-redeemed',
  'connect/share-token.inbound-created',
  'connect/share-token.ready',
  'connect/share-token.inbound-redeemed',
  'inquiry.reusable-persona-updated',
  'inquiry.reusable-persona-assurance-failed',
  'checkpoint.reusable-persona-used',
];

const DATE = /\b20\d\d-\d\d-\d\d\b/;

/** The body of the section whose heading line starts with `heading`, up to the next heading of its level or higher. */
export function sectionBody(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start < 0) {
    return null;
  }
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^#+ /.test(line) && (/^#+/.exec(line)?.[0].length ?? 9) <= level,
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** The cells of a Markdown table row, or null for any other line. */
function cellsOf(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

const finding = (role: RecordRole, rule: string, message: string, line?: number): CheckFinding => ({
  rule,
  path: CORRECTED_RECORDS[role],
  ...(line === undefined ? {} : { line }),
  message,
  severity: 'error',
});

function planFindings(text: string): CheckFinding[] {
  const findings: CheckFinding[] = [];
  text.split('\n').forEach((line, index) => {
    if (/\bk6\b/.test(line) && !line.includes('AGPL')) {
      findings.push(
        finding('plan', 'plan-k6', 'names k6 other than as excluded (AGPL-3.0; C282)', index + 1),
      );
    }
    if (line.includes('Helm (later)')) {
      findings.push(
        finding(
          'plan',
          'plan-helm-later',
          '"Helm (later)" stays: the chart is built (C282)',
          index + 1,
        ),
      );
    }
  });
  const next = sectionBody(text, '### Next release: Phase 11 deferrals (C286)');
  if (next === null) {
    findings.push(
      finding(
        'plan',
        'plan-next-release',
        'no "### Next release: Phase 11 deferrals (C286)" section (C282)',
      ),
    );
  } else {
    const missing = NEXT_RELEASE_ITEMS.filter((item) => !next.includes(item));
    if (missing.length > 0) {
      findings.push(
        finding(
          'plan',
          'plan-next-release',
          `C286's next-release section misses ${missing.join(', ')}`,
        ),
      );
    }
  }
  for (const heading of EARLIER_NEXT_RELEASE) {
    if (!text.split('\n').some((line) => line.startsWith(heading))) {
      findings.push(
        finding(
          'plan',
          'plan-next-release',
          `"${heading}" is gone: the sections stay beside each other, never merged`,
        ),
      );
    }
  }
  const phase11 = sectionBody(text, '### Phase 11') ?? '';
  const workflows = ['11A', '11B', '11C', '11D', '11E', '11F', '11G'].filter(
    (workflow) => !phase11.includes(workflow),
  );
  if (!phase11.includes('HTTP load test (vegeta')) {
    findings.push(
      finding(
        'plan',
        'plan-phase-11',
        'section 6 Phase 11 does not read "HTTP load test (vegeta ..."',
      ),
    );
  }
  if (workflows.length > 0) {
    findings.push(
      finding('plan', 'plan-phase-11', `section 6 Phase 11 does not name ${workflows.join(', ')}`),
    );
  }
  if (!/Q1\b/.test(phase11) || !/Q12\b/.test(phase11)) {
    findings.push(
      finding(
        'plan',
        'plan-phase-11',
        'section 6 Phase 11 does not name the owner items Q1 to Q12',
      ),
    );
  }
  const row = text.split('\n').find((line) => (cellsOf(line)?.[0] ?? '') === 'Connect / Reusable');
  const behaviours = [
    'peek',
    'field mappings',
    'client-side redemption',
    'environment-kind',
    'asynchronous',
    'one install',
    'reusable personas',
  ];
  const absent = row === undefined ? behaviours : behaviours.filter((word) => !row.includes(word));
  if (absent.length > 0) {
    findings.push(
      finding(
        'plan',
        'plan-connect-row',
        `section 2's Connect / Reusable row misses ${absent.join(', ')} (connect correction 2)`,
      ),
    );
  }
  if (!(sectionBody(text, '## 7.') ?? '').includes('threat-model rows added or changed')) {
    findings.push(
      finding(
        'plan',
        'plan-section-7',
        'section 7 does not ask each phase plan for its "threat-model rows added or changed" line',
      ),
    );
  }
  const risks = sectionBody(text, '## 9.') ?? '';
  if (!risks.includes('2026-03-19')) {
    findings.push(
      finding(
        'plan',
        'plan-section-9',
        'section 9 has no supply-chain row citing the Trivy compromise of 2026-03-19',
      ),
    );
  }
  if (!risks.split('\n').some((line) => line.includes('DSAR tooling') && line.includes('C253'))) {
    findings.push(
      finding(
        'plan',
        'plan-section-9',
        "section 9's biometric-law row's DSAR tooling does not point at C253",
      ),
    );
  }
  const acceptance = sectionBody(text, '## 10.') ?? '';
  const contracts = ['C273', 'C277', 'C278', 'C279', 'C280'].filter(
    (id) => !acceptance.includes(id),
  );
  if (contracts.length > 0) {
    findings.push(
      finding(
        'plan',
        'plan-section-10',
        `section 10 does not name ${contracts.join(', ')} beside its lines`,
      ),
    );
  }
  return findings;
}

function adrFindings(text: string): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const rule6 = sectionBody(text, '### 6. Self-assessed, never certified');
  if (rule6 === null) {
    findings.push(
      finding('adr', 'adr-rule-6', 'no "### 6. Self-assessed, never certified" section'),
    );
  } else if (
    /to be written by/i.test(rule6) ||
    rule6.split('\n').filter((line) => line.trim() !== '').length < 2
  ) {
    findings.push(finding('adr', 'adr-rule-6', 'rule 6 is still a placeholder (decision 46)'));
  }
  const status = text.split('\n').find((line) => line.startsWith('- **Status:**')) ?? '';
  if (/heading only|to be written/i.test(status)) {
    findings.push(finding('adr', 'adr-rule-6', 'the status still says rule 6 is not written'));
  }
  return findings;
}

function licenceFindings(text: string): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const lines = text.split('\n');
  const opencv = lines.findIndex((line) =>
    (cellsOf(line)?.[0] ?? '').startsWith('OpenCV (`opencv-python-headless`)'),
  );
  const bundled = lines.findIndex((line) => /^\| FFmpeg\b/.test(line));
  const row = bundled < 0 ? '' : (lines[bundled] ?? '');
  if (
    bundled < 0 ||
    !['libquadmath', 'libgfortran', 'KP11-39', 'pending the owner'].every((word) =>
      row.includes(word),
    )
  ) {
    findings.push(
      finding(
        'licences',
        'licence-kp11-39',
        'no row records FFmpeg, libquadmath and libgfortran inside opencv-python-headless as pending the owner (KP11-39; KP11-51)',
      ),
    );
  } else {
    if (/\b(allowed|granted)\b/i.test(row)) {
      findings.push(
        finding(
          'licences',
          'licence-kp11-39',
          "the KP11-39 row reads like an exception; it is a record of fact, the decision is the owner's (11E decisions item 19)",
          bundled + 1,
        ),
      );
    }
    if (opencv < 0 || bundled !== opencv + 1) {
      findings.push(
        finding(
          'licences',
          'licence-kp11-39',
          'the KP11-39 row is not beside the OpenCV row',
          bundled + 1,
        ),
      );
    }
  }
  lines.forEach((line, index) => {
    const cells = cellsOf(line);
    if (cells === null) {
      return;
    }
    const component = cells[0] ?? '';
    if (
      /\btslib\b/.test(component) &&
      (/owner to confirm/i.test(line) || /\bpending\b/i.test(line) || !line.includes('decision 46'))
    ) {
      findings.push(
        finding(
          'licences',
          'licence-tslib',
          'a tslib row waits on the owner, though Phase 5 decision 46 accepted 0BSD (C282, review H19)',
          index + 1,
        ),
      );
    }
    if (
      /^(nodemailer|JUnit 4)\b/.test(component) &&
      /owner to confirm/i.test(line) &&
      !line.includes('Q11')
    ) {
      findings.push(
        finding('licences', 'licence-q11', `${component}'s row does not point at Q11`, index + 1),
      );
    }
    if (
      component.startsWith('Libraries compiled into') &&
      (/\bpending\b/i.test(line) || !line.includes('decision 31'))
    ) {
      findings.push(
        finding(
          'licences',
          'licence-pdfium',
          "libpdfium's libraries wait on the owner, though Phase 5's owner-delegated decision 31 confirmed them",
          index + 1,
        ),
      );
    }
  });
  const toolsSection = sectionBody(text, '## 1.') ?? '';
  const rows = toolsSection
    .split('\n')
    .map(cellsOf)
    .filter((cells): cells is readonly string[] => cells !== null);
  for (const tool of DATED_TOOLS) {
    const row = rows.find((cells) => (cells[0] ?? '').startsWith(tool));
    if (row !== undefined && !DATE.test(row[1] ?? '')) {
      findings.push(
        finding(
          'licences',
          'licence-tool-date',
          `${tool}'s row has no release date in its version (C282, C258.3)`,
        ),
      );
    }
  }
  return findings;
}

function surfaceFindings(text: string): CheckFinding[] {
  const section = sectionBody(text, '## Connect (Phase 11') ?? '';
  const missing = MISSED_EVENTS.filter((name) => !section.includes(`\`${name}\``));
  const findings: CheckFinding[] = [];
  if (missing.length > 0) {
    findings.push(
      finding(
        'surface',
        'surface-connect',
        `the Connect section misses ${missing.join(', ')} (connect correction 1)`,
      ),
    );
  }
  if (
    !section
      .split('\n')
      .some((line) => line.includes('Confirmed against the code') && DATE.test(line))
  ) {
    findings.push(
      finding(
        'surface',
        'surface-connect',
        'the Connect section is not confirmed against the code with a date (C282)',
      ),
    );
  }
  return findings;
}

function nfcFindings(text: string): CheckFinding[] {
  const section = sectionBody(text, '## 8.') ?? '';
  const addendum = section.split('\n').find((line) => /^#+ Addendum/.test(line)) ?? '';
  const facts = ['24 December 2025', 'draft-ietf-oauth-sd-jwt-vc-', 'Digital Credentials API'];
  const absent = facts.filter((fact) => !section.includes(fact));
  if (!DATE.test(addendum) || absent.length > 0) {
    return [
      finding(
        'nfc',
        'nfc-addendum',
        `section 8 has no dated addendum with connect correction 3's facts${absent.length > 0 ? ` (missing ${absent.join(', ')})` : ''}`,
      ),
    ];
  }
  return [];
}

function phase6Findings(text: string): CheckFinding[] {
  const section = sectionBody(text, '### C88. Deferred') ?? '';
  const note = section.split('\n').find((line) => line.includes('Note') && DATE.test(line)) ?? '';
  return note.includes('report sharing') && note.includes('C286')
    ? []
    : [
        finding(
          'phase6',
          'phase6-c88',
          'C88 has no dated note that Phase 11 defers report sharing (connect correction 4; C286)',
        ),
      ];
}

const RULES: Record<RecordRole, (text: string) => CheckFinding[]> = {
  plan: planFindings,
  adr: adrFindings,
  licences: licenceFindings,
  surface: surfaceFindings,
  nfc: nfcFindings,
  phase6: phase6Findings,
};

/** C282's record test over the corrected records. */
export const checkCorrectedRecords: (repo: Repository) => CheckResult = (repo) => ({
  name: 'corrected-records',
  status: 'built',
  findings: (Object.keys(CORRECTED_RECORDS) as RecordRole[]).flatMap((role) => {
    const path = CORRECTED_RECORDS[role];
    return repo.exists(path)
      ? RULES[role](repo.readText(path))
      : [finding(role, 'missing', `${path} is missing (C282)`)];
  }),
});

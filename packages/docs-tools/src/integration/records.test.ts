/**
 * C282's record test (Workflow 11E, integration-11e): the corrected records hold what C282, the
 * 11E decisions (items 8 and 19) and KP11-51 demand. The fixtures pass whole and fail one rule each;
 * the real tree must pass.
 */
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { CORRECTED_RECORDS, checkCorrectedRecords } from './records.js';

const PLAN = [
  '# Plan',
  '',
  '## 2. Research basis',
  '',
  '| Capability | Behaviours | Module |',
  '|---|---|---|',
  '| Connect / Reusable | Connections, share tokens, peek with `full` or `presence`, field mappings, client-side redemption through a server-created inquiry, environment-kind matching, the asynchronous redeem, both organisations on one install, consent records (ours); reusable personas not built | Phase 11 |',
  '',
  '## 3. Architecture',
  '',
  '| Concern | Choice | License |',
  '|---|---|---|',
  '| Load testing | vegeta and the `load/` driver; Locust only under Q12; k6 is excluded (AGPL-3.0) | MIT |',
  '',
  '## 6. Phases',
  '',
  '### Phase 11: Connect / reusable KYC and hardening',
  '- HTTP load test (vegeta and a driver of ours; k6 is AGPL-3.0 and fails rule 4).',
  '- Seven Workflows: 11A, 11B, 11C, 11D, 11E, 11F and 11G; the owner items Q1 to Q12 pending.',
  '',
  '### Next release: carried owner items (Phase 9 C176, review H30)',
  '- Teams.',
  '',
  '### Next release: iOS (after Phase 11; owner decision 2026-10-29)',
  '- iOS.',
  '',
  '### Next release: Phase 11 deferrals (C286)',
  '- Sharing between two installs; SAML and SCIM; a KMS adapter; arm64 images; the wallet work; a self-service withdrawal link; a video liveness challenge; a `/metrics` endpoint; the address key’s per-country handling.',
  '',
  '## 7. Orchestration',
  '- Every phase plan has a "threat-model rows added or changed" line.',
  '',
  '## 9. Risks',
  '',
  '| Risk | Sev | Mitigation |',
  '|---|---|---|',
  '| Biometric law | HIGH | DSAR tooling (C253) |',
  '| A compromised scanner (the Trivy compromise of 2026-03-19) | MED | Pins (C258) |',
  '',
  '## 10. Acceptance (program-level)',
  '- [ ] Docs (C273, C277, C278, C279, C280, C281).',
  '',
].join('\n');

const ADR = [
  '# ADR 0010',
  '',
  '- **Status:** Accepted (Workflow 11E, integration-11e, 2026-11-20).',
  '',
  '### 6. Self-assessed, never certified',
  '',
  'The threat model is our own assessment.',
  '',
].join('\n');

const LICENCES = [
  '# Third-party licenses',
  '',
  '## 1. Development infrastructure and CI (in use)',
  '',
  '| Component | Version | License | Source | Usage | Status |',
  '|---|---|---|---|---|---|',
  '| gitleaks | 8.30.1 (2026-03-21) | MIT | GitHub | CI | verified |',
  '',
  '## 2. Runtime and build libraries',
  '',
  '| Component | Version | License | Source | Usage | Status |',
  '|---|---|---|---|---|---|',
  '| OpenCV (`opencv-python-headless`), onnxruntime | 5.0.0.93, 1.31.0 | Apache-2.0, MIT | PyPI | vision | verified |',
  '| FFmpeg, libquadmath, libgfortran (inside the `opencv-python-headless` wheel) | 8.1.1, bundled, bundled | LGPL-2.1-or-later, LGPL-2.1-or-later, GPL-3.0-or-later WITH GCC-exception-3.1 | the wheel | vision image | recorded 2026-11-20: pending the owner (KP11-39) |',
  '| tslib | 1.14.1, 2.8.1 | 0BSD | npm | transitive | verified; accepted under Phase 5 decision 46 |',
  '| nodemailer | 10.1.6 | MIT-0 | npm | api | **Owner to confirm (Phase 11 Q11)** |',
  '| pvutils, pvtsutils, tslib | 1.2.0, 1.3.6, 2.8.1 | MIT, MIT, 0BSD | npm | emrtd | verified; tslib accepted under Phase 5 decision 46 |',
  '| Libraries compiled into `libpdfium.so` | 8076 | FTL | wheel | vision | verified; confirmed under Phase 5 decision 31 |',
  '',
  '## 5. Build/test/dev-only weak-copyleft exceptions',
  '',
  '| Component | License | Pulled in by | Scope | Decision |',
  '|---|---|---|---|---|',
  '| JUnit 4 | EPL-1.0 | Robolectric | test | **owner to confirm** (Phase 11 Q11) |',
  '',
].join('\n');

const SURFACE = [
  '# Surface',
  '',
  '## Connect (Phase 11, Workflow 11A; C282)',
  '',
  '- `connect/share-token.outbound-created`: built',
  '- `connect/share-token.outbound-redeemed`: built',
  '- `connect/share-token.inbound-created`: built',
  '- `connect/share-token.ready`: not built',
  '- `connect/share-token.inbound-redeemed`: built',
  '- `inquiry.reusable-persona-updated`: not built',
  '- `inquiry.reusable-persona-assurance-failed`: not built',
  '- `checkpoint.reusable-persona-used`: not built',
  '',
  'Confirmed against the code on 2026-11-20 (Workflow 11E, integration-11e).',
  '',
].join('\n');

const NFC = [
  '# NFC',
  '',
  '## 8. Stretch goal: mDL / mdoc and verifiable credentials',
  '',
  '### Addendum (2026-11-20, Phase 11 C282)',
  '',
  '- HAIP 1.0: Final, 24 December 2025.',
  '- SD-JWT VC: `draft-ietf-oauth-sd-jwt-vc-27`.',
  '- The Digital Credentials API: a Working Draft.',
  '',
  '## Needs the owner',
  '',
].join('\n');

const PHASE6 = [
  '# Phase 6',
  '',
  '### C88. Deferred',
  '',
  'Connect snapshots (Phase 11).',
  '**Note (2026-11-20, Phase 11, C282):** Phase 11 defers report sharing (C286).',
  '',
  '### C89. Fixtures',
  '',
].join('\n');

const GOOD: Record<string, string> = {
  [CORRECTED_RECORDS.plan]: PLAN,
  [CORRECTED_RECORDS.adr]: ADR,
  [CORRECTED_RECORDS.licences]: LICENCES,
  [CORRECTED_RECORDS.surface]: SURFACE,
  [CORRECTED_RECORDS.nfc]: NFC,
  [CORRECTED_RECORDS.phase6]: PHASE6,
};

/** The fixture tree with one file's text changed. */
function withChange(path: string, change: (text: string) => string): Record<string, string> {
  return { ...GOOD, [path]: change(GOOD[path] ?? '') };
}

const rulesOf = (files: Record<string, string>): readonly string[] =>
  checkCorrectedRecords(createMemoryRepository(files)).findings.map((finding) => finding.rule);

describe('checkCorrectedRecords', () => {
  it('passes a tree that holds every correction', () => {
    const result = checkCorrectedRecords(createMemoryRepository(GOOD));
    expect(result).toMatchObject({ name: 'corrected-records', status: 'built' });
    expect(result.findings).toEqual([]);
  });

  it('names every missing record', () => {
    const findings = checkCorrectedRecords(createMemoryRepository({})).findings;
    expect(findings.map((finding) => finding.path).sort()).toEqual(
      Object.values(CORRECTED_RECORDS).sort(),
    );
    expect(new Set(findings.map((finding) => finding.rule))).toEqual(new Set(['missing']));
  });

  it('fails PLAN naming k6 other than as excluded', () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.plan, (text) => `${text}- Security-scan, k6 load test.\n`),
      ),
    ).toContain('plan-k6');
  });

  it('fails PLAN keeping "Helm (later)"', () => {
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => `${text}infra/ Helm (later)\n`)),
    ).toContain('plan-helm-later');
  });

  it("fails PLAN without C286's next-release section, or one that misses an item", () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.plan, (text) =>
          text.replace('### Next release: Phase 11 deferrals (C286)', '### Later'),
        ),
      ),
    ).toContain('plan-next-release');
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => text.replace('arm64 images; ', ''))),
    ).toContain('plan-next-release');
  });

  it('fails PLAN that merged or dropped an earlier next-release section', () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.plan, (text) =>
          text.replace('### Next release: iOS (after Phase 11; owner decision 2026-10-29)\n', ''),
        ),
      ),
    ).toContain('plan-next-release');
  });

  it("fails PLAN's Phase 11 without the HTTP load test, the seven Workflows or Q1-Q12", () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.plan, (text) =>
          text.replace('HTTP load test (vegeta', 'Load test (something'),
        ),
      ),
    ).toContain('plan-phase-11');
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => text.replace('11F and 11G', '11F'))),
    ).toContain('plan-phase-11');
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => text.replace('Q1 to Q12', 'the Qs'))),
    ).toContain('plan-phase-11');
  });

  it("fails PLAN's Connect row without connect correction 2's behaviours", () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.plan, (text) =>
          text.replace('client-side redemption', 'redemption'),
        ),
      ),
    ).toContain('plan-connect-row');
  });

  it("fails PLAN's sections 7, 9 and 10 without their corrections", () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.plan, (text) =>
          text.replace('threat-model rows added or changed', 'a line'),
        ),
      ),
    ).toContain('plan-section-7');
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => text.replace('2026-03-19', 'once'))),
    ).toContain('plan-section-9');
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => text.replace('(C253)', ''))),
    ).toContain('plan-section-9');
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.plan, (text) => text.replace('C279, ', ''))),
    ).toContain('plan-section-10');
  });

  it('fails ADR 0010 while rule 6 is a placeholder or the status says so', () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.adr, (text) =>
          text.replace(
            'The threat model is our own assessment.',
            'To be written by `integration-11e`.',
          ),
        ),
      ),
    ).toContain('adr-rule-6');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.adr, (text) =>
          text.replace('Accepted (', 'Accepted; rule 6 is stated here as a heading only ('),
        ),
      ),
    ).toContain('adr-rule-6');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.adr, (text) =>
          text.replace('### 6. Self-assessed, never certified', '### 6. Later'),
        ),
      ),
    ).toContain('adr-rule-6');
  });

  it("fails the licence file without KP11-51's row beside OpenCV's, or with it as an exception", () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.licences, (text) =>
          text
            .split('\n')
            .filter((line) => !line.startsWith('| FFmpeg'))
            .join('\n'),
        ),
      ),
    ).toContain('licence-kp11-39');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.licences, (text) =>
          text.replace('pending the owner (KP11-39)', 'allowed 2026-11-20'),
        ),
      ),
    ).toContain('licence-kp11-39');
    const moved = withChange(CORRECTED_RECORDS.licences, (text) => {
      const lines = text.split('\n');
      const row = lines.findIndex((line) => line.startsWith('| FFmpeg'));
      const [ffmpeg] = lines.splice(row, 1);
      lines.push(ffmpeg ?? '');
      return lines.join('\n');
    });
    expect(rulesOf(moved)).toContain('licence-kp11-39');
  });

  it('fails a tslib row that still waits on the owner, and an owner row without Q11', () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.licences, (text) =>
          text.replace(
            'verified; accepted under Phase 5 decision 46 |',
            'verified. **Owner to confirm:** 0BSD |',
          ),
        ),
      ),
    ).toContain('licence-tslib');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.licences, (text) =>
          text.replace('tslib accepted under Phase 5 decision 46', 'accepted pending'),
        ),
      ),
    ).toContain('licence-tslib');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.licences, (text) =>
          text.replace('**owner to confirm** (Phase 11 Q11)', '**owner to confirm**'),
        ),
      ),
    ).toContain('licence-q11');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.licences, (text) =>
          text.replace('confirmed under Phase 5 decision 31', 'owner confirmation pending'),
        ),
      ),
    ).toContain('licence-pdfium');
  });

  it("fails a C258.3 tool's row without its release date", () => {
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.licences, (text) => text.replace(' (2026-03-21)', ''))),
    ).toContain('licence-tool-date');
  });

  it('fails the surface index without an event or the confirmation', () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.surface, (text) =>
          text.replace('`checkpoint.reusable-persona-used`', '`checkpoint.x`'),
        ),
      ),
    ).toContain('surface-connect');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.surface, (text) =>
          text.replace('Confirmed against the code', 'Written'),
        ),
      ),
    ).toContain('surface-connect');
  });

  it('fails the Phase 5 section 8 without its dated addendum', () => {
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.nfc, (text) => text.replace('24 December 2025', 'some day')),
      ),
    ).toContain('nfc-addendum');
    expect(
      rulesOf(
        withChange(CORRECTED_RECORDS.nfc, (text) =>
          text.replace('### Addendum (2026-11-20, Phase 11 C282)', '### Addendum'),
        ),
      ),
    ).toContain('nfc-addendum');
  });

  it('fails the Phase 6 C88 without its dated note', () => {
    expect(
      rulesOf(withChange(CORRECTED_RECORDS.phase6, (text) => text.replace(/\*\*Note.*\n/, ''))),
    ).toContain('phase6-c88');
  });
});

describe('the corrected records in this repository', () => {
  it('pass their record test', () => {
    const result = checkCorrectedRecords(createRepository(REPOSITORY_ROOT));
    expect(result.status).toBe('built');
    expect(result.findings.map((finding) => `${finding.rule}: ${finding.message}`)).toEqual([]);
  });
});

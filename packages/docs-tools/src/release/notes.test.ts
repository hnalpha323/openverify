/**
 * C284.4: the generated release notes (docs-release; H21). The committed file equals a fresh render,
 * every disclosure a contract sends to the notes is in it, and release:check fails on either.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryRepository, createRepository, REPOSITORY_ROOT } from '../repository.js';
import { checkRelease, renderRelease } from './index.js';
import {
  NOTES_PATH,
  deviceProofs,
  formatFigure,
  notesFindings,
  ownerOutcomes,
  readNotesInputs,
  renderNotes,
  renderNotesFile,
  requiredDisclosures,
  rowSentence,
  runtimeBases,
} from './notes.js';
import { fixtureChecklist, fixtureFiles } from './release-check.fixtures.js';
import { RELEASE_CHECK_DEPS } from './release-check.js';

const C289 = [
  '| Item | Built in 11A–11F | Switch | 11G, when granted | If declined |',
  '|---|---|---|---|---|',
  '| Q1 repository visibility | everything, private | — | public | stays private |',
  '| Phase 10 P2 and Phase 4 decision 11 (Eigen) | the flow image twice | the build flag | publish it | the image without guidance is the release’s |',
].join('\n');

function notesRepo(
  changes: Record<string, string | null> = {},
): ReturnType<typeof createMemoryRepository> {
  const files: Record<string, string> = {
    ...fixtureFiles(),
    'docs/plans/phase-11.plan.md': `${fixtureFiles()['docs/plans/phase-11.plan.md'] ?? ''}\n\n${C289}\n`,
    'infra/docker/api.Dockerfile':
      'ARG NODE_IMAGE=node:22-synthetic@sha256:0000\nFROM ${NODE_IMAGE}\n',
    'services/vision/Dockerfile': 'ARG PYTHON_IMAGE=python:3.12-synthetic@sha256:1111\n',
    'network/sources.json': JSON.stringify({
      sources: [
        {
          id: 'a',
          attribution: 'IP data by a publisher',
          link_back: 'https://publisher.example',
          enabled_by_default: true,
        },
      ],
    }),
    'THIRD_PARTY_LICENSES.md':
      '| Component | Licence |\n|---|---|\n| demo-lib | MIT-0; owner to confirm |\n',
    'docs/PROGRESS.md': [
      fixtureFiles()['docs/PROGRESS.md'] ?? '',
      '',
      '### Unproved on a device or an emulator',
      '',
      '- device proof open: `SyntheticDeviceTest` on an emulator.',
      '',
    ].join('\n'),
  };
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) {
      Reflect.deleteProperty(files, path);
    } else {
      files[path] = text;
    }
  }
  const repo = createMemoryRepository(files);
  const rendered = renderNotesFile(repo);
  return rendered === null || NOTES_PATH in changes
    ? repo
    : createMemoryRepository({ ...files, [NOTES_PATH]: rendered.content });
}

describe('the notes inputs', () => {
  it('reads C289 from the plan, the runtime bases and the device proofs', () => {
    expect(ownerOutcomes(C289)).toEqual([
      {
        item: 'Q1 repository visibility',
        built: 'everything, private',
        granted: 'public',
        declined: 'stays private',
      },
      {
        item: 'Phase 10 P2 and Phase 4 decision 11 (Eigen)',
        built: 'the flow image twice',
        granted: 'publish it',
        declined: 'the image without guidance is the release’s',
      },
    ]);
    expect(ownerOutcomes('# no table')).toEqual([]);
    expect(runtimeBases(notesRepo())).toEqual([
      {
        image: 'openverify/api',
        path: 'infra/docker/api.Dockerfile',
        base: 'node:22-synthetic@sha256:0000',
      },
      {
        image: 'openverify/vision',
        path: 'services/vision/Dockerfile',
        base: 'python:3.12-synthetic@sha256:1111',
      },
    ]);
    expect(deviceProofs('# none')).toEqual([]);
    expect(readNotesInputs(createMemoryRepository({}))).toBeNull();
    expect(renderNotesFile(createMemoryRepository({}))).toBeNull();
  });

  it('prints figures the same way every time', () => {
    expect([14592, 390.048, 26.6, 3.933, 0.006406, -169.141, 1.05].map(formatFigure)).toEqual([
      '14,592',
      '390.0',
      '26.6',
      '3.933',
      '0.006406',
      '-169.1',
      '1.05',
    ]);
    expect(
      rowSentence({
        id: 'api-reads',
        title: 'API reads at 100 requests/s',
        contract: 'C269.1',
        budget: { metric: 'p95', comparison: '<=', value: 150, unit: 'ms' },
        verdict: 'missed',
        median: 390.048,
        unit: 'ms',
        gap: 240.048,
        configuration: 'default',
      }),
    ).toBe(
      '`api-reads` (C269.1): API reads at 100 requests/s: **missed**; 390.0 ms; budget p95 <= 150 ms; gap +240.0 (default)',
    );
  });
});

describe('the rendered notes', () => {
  const repo = notesRepo();
  const inputs = readNotesInputs(repo);
  const text = inputs === null ? '' : renderNotes(inputs);

  it('holds every required disclosure', () => {
    expect(inputs).not.toBeNull();
    const disclosures = inputs === null ? [] : requiredDisclosures(inputs);
    expect(disclosures.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'base-sources',
        'base:infra/docker/api.Dockerfile',
        'owner:Q1',
        'owner:P5',
        'calibration:slow-row',
        'sface',
        'consent-texts',
        'list-cap',
        'network-data',
        'db-ip',
        'licence:3',
        'defaults-taken',
        'device-proof',
      ]),
    );
    for (const disclosure of disclosures) {
      expect(text, disclosure.id).toContain(disclosure.text);
    }
  });

  it('is deterministic and ends with one newline', () => {
    expect(inputs === null ? '' : renderNotes(inputs)).toBe(text);
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true);
  });

  it('says "staged run pending" without a record, and lists the record when there is one', () => {
    expect(text).toContain('Staged run 1 on `synthetic` (2026-11-20)');
    expect(text).not.toContain('Staged run pending');
    const staged = readNotesInputs(notesRepo());
    expect(staged?.staged?.runId).toBe('1');
    const pending = readNotesInputs(notesRepo({ 'docs/release/staged-run.json': null }));
    expect(pending === null ? '' : renderNotes(pending)).toContain('Staged run pending');
  });

  it('says nothing is signed yet and what the first approved dispatch will do once the publish job is wired (C262, C285; rule 10)', () => {
    expect(inputs).not.toBeNull();
    if (inputs === null) {
      return;
    }
    const off = requiredDisclosures({ ...inputs, publishWired: false });
    expect(off.map((item) => item.id)).toContain('unsigned');
    expect(off.map((item) => item.id)).not.toContain('publish-wired');

    const wired = { ...inputs, publishWired: true };
    const disclosures = requiredDisclosures(wired);
    expect(disclosures.map((item) => item.id)).not.toContain('unsigned');
    const statement = disclosures.find((item) => item.id === 'publish-wired');
    expect(statement?.contract).toBe('C262, C285, C289 (Q1-Q4)');
    expect(statement?.text).toMatch(
      /^No artifact of this release is signed, attested or published yet\./,
    );
    expect(statement?.text).toContain('`OPENVERIFY_PUBLISH`');
    expect(statement?.text).toContain(
      'a dispatch is a dry run unless its `dry-run` input is false',
    );
    expect(statement?.text).toContain('The first approved dispatch with `dry-run` false will push');
    expect(statement?.text).toContain('Staged workflow artifacts stay unsigned');
    expect(statement?.text).not.toMatch(
      /\b(?:was|were|has been|have been) (?:signed|published|pushed)\b/,
    );
    expect(renderNotes(wired)).toContain(statement?.text ?? 'missing');
    expect(renderNotes(wired)).not.toContain('is written but runs only when');
  });

  it('shows a granted item as built under its grant, from its checklist line, never the pending column (integration-11g)', () => {
    const granted = readNotesInputs(
      notesRepo({
        'docs/release/checklist.md': fixtureChecklist([
          '| Q1 | Q1, the repository visibility: granted; public at the release step | done | owner | `docs/PROGRESS.md` | 2026-11-21 |',
        ]),
      }),
    );
    const rendered = granted === null ? '' : renderNotes(granted);
    expect(rendered).toContain(
      '- **Q1** (repository visibility): granted. Built under the grant: Q1, the repository visibility: granted; public at the release step. If the owner reverses it: stays private.',
    );
    expect(rendered).not.toContain('Built meanwhile: everything, private');
    expect(text).toContain('Built meanwhile: everything, private. If declined: stays private.');
  });

  it('shows a declined item with the outcome the release ships and what was built for it (integration-11g)', () => {
    const declined = readNotesInputs(
      notesRepo({
        'docs/PROGRESS.md': `${fixtureFiles()['docs/PROGRESS.md'] ?? ''}\n**Q1:** declined (synthetic): stays private.\n`,
        'docs/release/checklist.md': fixtureChecklist([
          '| Q1 | Q1, the repository visibility: declined; private | done | owner | `docs/PROGRESS.md` | 2026-11-21 |',
        ]),
      }),
    );
    expect(declined === null ? '' : renderNotes(declined)).toContain(
      '- **Q1** (repository visibility): declined. The release ships the decline outcome: stays private. Built: Q1, the repository visibility: declined; private.',
    );
  });

  it('states the decline outcome of the flow image when the release ships it', () => {
    const declined = readNotesInputs(
      notesRepo({
        'docs/release/checklist.md': (fixtureFiles()['docs/release/checklist.md'] ?? '').replace(
          '`guidance`',
          '`noguidance`',
        ),
      }),
    );
    expect(declined === null ? '' : renderNotes(declined)).toContain(
      'on-device face guidance is off in the web flow',
    );
    expect(text).toContain('while Phase 10 P2 stays granted narrowly');
  });
});

describe('the notes rules in release:check (notes-fresh, notes-disclosure)', () => {
  it('passes a committed copy of a fresh render', () => {
    expect(notesFindings(notesRepo())).toEqual([]);
  });

  it('fails a missing file and a stale one', () => {
    expect(
      notesFindings(notesRepo({ [NOTES_PATH]: null })).map((finding) => finding.message),
    ).toEqual([
      'the release notes do not exist: run pnpm --filter @openverify/docs-tools docs:release',
    ]);
    const stale = notesFindings(notesRepo({ [NOTES_PATH]: '# Release notes\n' }));
    expect(stale.map((finding) => finding.rule)).toContain('notes-fresh');
  });

  it('fails a notes file that lost a required disclosure', () => {
    const fresh = renderNotesFile(notesRepo());
    const cut = (fresh?.content ?? '')
      .replace(/^- device proof.*$/m, '')
      .replace('`SyntheticDeviceTest` on an emulator.', '');
    const findings = notesFindings(notesRepo({ [NOTES_PATH]: cut }));
    expect(findings.map((finding) => finding.rule)).toEqual(['notes-fresh', 'notes-disclosure']);
    expect(findings[1]?.message).toMatch(/^the notes lack the disclosure device-proof \(rule 25\)/);
  });

  it('is part of the real release:check and of the area check', () => {
    expect(RELEASE_CHECK_DEPS.notes(notesRepo({ [NOTES_PATH]: null }))).toHaveLength(1);
    expect(notesFindings(createMemoryRepository({}))).toEqual([]);
  });
});

describe('the committed notes (C284.4)', () => {
  const real = createRepository(REPOSITORY_ROOT);

  it('equal a fresh render and hold every disclosure', () => {
    expect(notesFindings(real)).toEqual([]);
  });

  it('are what the area renders, and the area check finds nothing', () => {
    const rendered = renderRelease(real);
    expect(rendered.status).toBe('built');
    expect(rendered.files.map((file) => file.path)).toEqual([NOTES_PATH]);
    expect(checkRelease(real).flatMap((result) => result.findings)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from './repository.js';
import { WORDING_FILES, checkWording, wordingFindings, wordingScope } from './wording.js';

const rules = (path: string, text: string) =>
  wordingFindings(path, text).map((f) => `${f.rule}@${String(f.line)}`);

describe('C274.5: ASVS and MASVS are never "certified" or "compliant"', () => {
  it.each([
    'OpenVerify is ASVS Level 2 certified.',
    'The SDK is MASVS compliant.',
    'Certified against OWASP ASVS 5.0.0 Level 2.',
    'Our ASVS certification covers the console.',
    'This release complies with MASVS v2.1.0.',
    'The "ASVS certified" badge is ours.',
  ])('refuses: %s', (sentence) => {
    expect(rules('docs/security/README.md', sentence)).toEqual(['asvs-masvs-claim@1']);
  });

  it('finds a claim wrapped across the lines of one paragraph, on its first line', () => {
    expect(
      rules('docs/security/README.md', 'Intro.\n\nThe platform meets ASVS\nand is certified.'),
    ).toEqual(['asvs-masvs-claim@3']);
  });

  it.each([
    'Self-assessed against OWASP ASVS 5.0.0 Level 2, never certified.',
    'OWASP certifies nothing; the ASVS rows are self-assessed.',
    'No certification is claimed for the ASVS or MASVS rows.',
    'The MASVS rows do not make the host app compliant.',
    'The ASVS checklist and the compliance guide are indexed here.',
    'A REAL ID compliant card is detected.',
    'A test refuses "compliant" and `certified` next to ASVS anywhere in docs/.',
  ])('accepts a denial, a quoted mention of the word or an unrelated word: %s', (sentence) => {
    expect(rules('docs/security/README.md', sentence)).toEqual([]);
  });

  // F007 (Workflow 11F review): a denial counts only for the claim word it denies, in its own
  // clause, never because "no", "not" or "none" appears anywhere in the sentence.
  it.each([
    'There is no gap: the platform is ASVS L2 compliant.',
    'There is no gap and it is ASVS compliant.',
    'Not only certified, it complies with ASVS Level 2.',
    'No row is a gap, so the console is ASVS certified.',
    'The MASVS rows leave nothing open: the SDK is certified.',
  ])('refuses a claim beside a denial of something else: %s', (sentence) => {
    expect(rules('docs/security/README.md', sentence)).toEqual(['asvs-masvs-claim@1']);
  });

  it.each([
    'Neither certified nor compliant: the ASVS rows are self-assessed.',
    'The ASVS rows are used without claiming that the platform is compliant.',
    "The ASVS checklist isn't a certification.",
  ])('accepts a denial of the claim word itself: %s', (sentence) => {
    expect(rules('docs/security/README.md', sentence)).toEqual([]);
  });

  it('reads neither fenced code nor an inline code span: tool output and fixtures quote text', () => {
    const evidence = [
      'The run:',
      '',
      '```text',
      ' FAIL  src/wording.test.ts > refuses: The SDK is MASVS compliant.',
      '```',
      '',
      'A fixture each way: `\'The "ASVS certified" badge is ours.\'` fails.',
    ].join('\n');
    expect(rules('docs/tdd/example.tdd.md', evidence)).toEqual([]);
    expect(
      rules(
        'docs/tdd/example.tdd.md',
        "Each way: `'refuses \\`certified\\` next to ASVS'` passes.",
      ),
    ).toEqual([]);
    expect(rules('docs/security/README.md', 'The SDK is `MASVS` compliant.')).toEqual([
      'asvs-masvs-claim@1',
    ]);
  });

  it('reads a CSV row by row, so a note naming ASVS is checked on its own', () => {
    const csv =
      'id,level,status,notes\nv5.0.0-1.1.1,2,met,ASVS row certified by us\nv5.0.0-1.1.2,1,gap,fine';
    expect(rules('docs/security/asvs-5.0.0-l2.csv', csv)).toEqual(['asvs-masvs-claim@2']);
  });
});

describe('C274.5: the compliance guide says "compliant" and "complies" only to deny them', () => {
  it('refuses a claim anywhere under docs/compliance/', () => {
    expect(
      rules('docs/compliance/roles.md', 'A deployment of OpenVerify complies with the GDPR.'),
    ).toEqual(['compliance-claim@1']);
    expect(
      rules('docs/compliance/README.md', 'Your install is compliant once configured.'),
    ).toEqual(['compliance-claim@1']);
  });

  it('refuses a claim there beside a denial of something else (F007)', () => {
    expect(
      rules(
        'docs/compliance/README.md',
        'No setting is needed: an install complies with the GDPR.',
      ),
    ).toEqual(['compliance-claim@1']);
  });

  it('accepts a denying sentence there, and the words elsewhere in docs/', () => {
    expect(
      rules(
        'docs/compliance/README.md',
        'Nothing here says that a deployment complies with any law.',
      ),
    ).toEqual([]);
    expect(
      rules('docs/compliance/README.md', 'This guide does not make an install compliant.'),
    ).toEqual([]);
    expect(rules('docs/checks/government-id.md', 'A REAL ID compliant card is detected.')).toEqual(
      [],
    );
  });
});

describe('the scope', () => {
  it('reads docs/, every README and the single files that exist, sorted', () => {
    const repo = createMemoryRepository({
      'docs/a.md': '',
      'docs/b.csv': '',
      'docs/api/openapi.json': '',
      'README.md': '',
      'packages/node/README.md': '',
      'packages/node/node_modules/x/README.md': '',
      'deploy/helm/openverify/Chart.yaml': '',
      'apps/api/src/x.ts': '',
    });

    expect(wordingScope(repo)).toEqual([
      'README.md',
      'deploy/helm/openverify/Chart.yaml',
      'docs/a.md',
      'docs/b.csv',
      'packages/node/README.md',
    ]);
    expect(WORDING_FILES).toEqual([
      'SECURITY.md',
      'deploy/helm/openverify/Chart.yaml',
      'deploy/helm/openverify/templates/NOTES.txt',
    ]);
  });

  it('holds over the repository: the npm packages, the chart and SECURITY.md among the files', () => {
    const repo = createRepository(REPOSITORY_ROOT);
    const scope = wordingScope(repo);

    expect(scope).toEqual(
      expect.arrayContaining([
        'README.md',
        'SECURITY.md',
        'packages/node/README.md',
        'packages/sdk-js/README.md',
        'packages/sdk-react/README.md',
        'deploy/helm/openverify/Chart.yaml',
        'deploy/helm/openverify/templates/NOTES.txt',
        'docs/compliance/automated-decisions.md',
        'docs/release/notes.md',
      ]),
    );
    expect(checkWording(repo)).toEqual({ name: 'wording', status: 'built', findings: [] });
  });
});

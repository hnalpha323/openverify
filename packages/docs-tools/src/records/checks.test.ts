/** C276 (Workflow 11E, `docs-records`): the record rules the hand-written records share. */
import { describe, expect, it } from 'vitest';
import { draftMarker } from '../docs-tree.js';
import { createMemoryRepository } from '../repository.js';
import {
  codeSpans,
  commandFindings,
  draftFindings,
  pathFindings,
  requiredSpanFindings,
  variableFindings,
} from './checks.js';

const PAGE = 'docs/security/page.md';

describe('code spans', () => {
  it('reads each inline span, never a fenced block', () => {
    const text = ['One `a` and `b c`.', '```', '`not-this`', '```', 'Last `d`.'].join('\n');
    expect(codeSpans(text)).toEqual(['a', 'b c', 'd']);
  });
});

describe('a remaining draft marker', () => {
  it('is a finding', () => {
    expect(draftFindings(PAGE, `# T\n\n${draftMarker('docs-records')}\n`)).toHaveLength(1);
    expect(draftFindings(PAGE, '# T\n\nWritten.\n')).toEqual([]);
  });
});

describe('cited paths', () => {
  const repo = createMemoryRepository({
    'apps/api/src/logger.ts': '',
    'docs/security/README.md': '',
  });

  it('pass when the file or the directory exists', () => {
    const text = 'See `apps/api/src/logger.ts`, `apps/api/src/` and `docs/security/README.md`.';
    expect(pathFindings(repo, PAGE, text)).toEqual([]);
  });

  it('fail when it does not, naming the path', () => {
    const findings = pathFindings(repo, PAGE, 'See `apps/api/src/missing.ts`.');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('apps/api/src/missing.ts');
  });

  it('read a path with a line number or a glob as its file or its directory', () => {
    const text = 'See `apps/api/src/logger.ts:22` and `docs/security/*.md`.';
    expect(pathFindings(repo, PAGE, text)).toEqual([]);
  });

  it('leave a span that is not a repository path alone', () => {
    expect(pathFindings(repo, PAGE, 'A `network/<source>/<sha256>` key and `a/b`.')).toEqual([]);
  });
});

describe('cited commands', () => {
  const repo = createMemoryRepository({
    'package.json': JSON.stringify({ name: 'root', scripts: { 'release:check': 'x' } }),
    'apps/api/package.json': JSON.stringify({
      name: '@openverify/api',
      scripts: { 'kek:rewrap': 'x' },
    }),
  });

  it('pass when the package has the script', () => {
    const text =
      'Run `pnpm --filter @openverify/api kek:rewrap --dry-run`, then `pnpm release:check`.';
    expect(commandFindings(repo, PAGE, text)).toEqual([]);
  });

  it('fail on a missing script or package', () => {
    const text =
      'Run `pnpm --filter @openverify/api kek:rotate` and `pnpm --filter @openverify/nope x`.';
    expect(commandFindings(repo, PAGE, text)).toHaveLength(2);
  });
});

describe('cited configuration variables', () => {
  it('pass a registered name, its _FILE form and a pattern name', () => {
    const text =
      '`OPENVERIFY_KEK`, `OPENVERIFY_KEK_FILE`, `OPENVERIFY_SEED_ADMIN_PASSWORD`, `DATABASE_URL`.';
    expect(variableFindings(PAGE, text)).toEqual([]);
  });

  it('fail an unregistered name', () => {
    expect(variableFindings(PAGE, '`OPENVERIFY_NOT_A_VARIABLE`.')).toHaveLength(1);
  });

  it('fail the _FILE form of a name that has none', () => {
    expect(variableFindings(PAGE, '`OPENVERIFY_TRUST_PROXY_FILE`.')).toHaveLength(1);
  });
});

describe('required spans', () => {
  it('name each one the page lacks, with why', () => {
    const findings = requiredSpanFindings(PAGE, 'Has `a`.', [
      { span: 'a', why: 'first' },
      { span: 'b', why: 'second' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('second');
  });
});

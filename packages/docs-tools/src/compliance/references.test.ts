import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { compliancePages } from './pages.js';
import { backtickedPaths, referenceFindings, relativeLinks } from './references.js';

describe('the paths and links a compliance page cites', () => {
  it('reads repository paths in backticks, dropping a line suffix and skipping patterns', () => {
    const text = [
      'See `apps/api/src/a.ts:12`, `docs/x/` and `packages/core/src/b.ts:3-9`.',
      'Not paths: `account-export`, `OPENVERIFY_X`, `docs/*.md`, `apps/{a,b}`, `notes.md`.',
    ].join('\n');
    expect(backtickedPaths(text)).toEqual([
      'apps/api/src/a.ts',
      'docs/x/',
      'packages/core/src/b.ts',
    ]);
  });

  it('reads relative links, dropping anchors and skipping schemes and pure anchors', () => {
    const text =
      '[a](roles.md#x) [b](https://example.com) [c](#top) [d](../checks/nfc.md) [e](mailto:x@example.com)';
    expect(relativeLinks(text)).toEqual(['roles.md', '../checks/nfc.md']);
  });

  it('finds a missing path, a missing directory and a broken link', () => {
    const repo = createMemoryRepository({
      'apps/api/src/a.ts': '',
      'docs/x/one.md': '',
      'docs/compliance/roles.md': '',
    });
    const text =
      '`apps/api/src/a.ts` `apps/api/src/gone.ts` `docs/x/` `docs/y/` [r](roles.md) [g](gone.md) [d](../x/)';
    expect(
      referenceFindings(repo, 'docs/compliance/page.md', text).map((item) => item.message),
    ).toEqual([
      'names apps/api/src/gone.ts, which does not exist',
      'names docs/y/, which does not exist',
      'links gone.md (docs/compliance/gone.md), which does not exist',
    ]);
  });

  it('finds nothing missing in the committed guide', () => {
    const repo = createRepository(REPOSITORY_ROOT);
    const findings = compliancePages((dir) => repo.listFiles(dir)).flatMap((path) =>
      referenceFindings(repo, path, repo.readText(path)),
    );
    expect(findings).toEqual([]);
  });
});

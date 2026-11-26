/** C276 (Workflow 11E, `docs-records`): the area's entry points over the real tree. */
import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import { DATA_CLASSIFICATION_PATH } from './classification.js';
import { checkRecords, renderRecords } from './index.js';

const repo = createRepository(REPOSITORY_ROOT);

describe('the records area', () => {
  it('renders the data classification, the one generated page it owns', () => {
    const result = renderRecords(repo);
    expect(result.area).toBe('records');
    expect(result.status).toBe('built');
    expect(result.files.map((file) => file.path)).toEqual([DATA_CLASSIFICATION_PATH]);
  });

  it('renders what is committed', () => {
    expect(staleFiles(repo, renderRecords(repo).files)).toEqual([]);
  });

  it('finds nothing to fix in the committed records', () => {
    const results = checkRecords(repo);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.status, result.name).toBe('built');
      expect(result.findings, result.name).toEqual([]);
    }
  });
});

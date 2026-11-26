/** docs-catalog's entry points (C279, C280, C281): what `docs:catalog` writes and what the area's check finds. */
import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import { API_README_PATH } from './api-reference.js';
import { CATALOG_PATH } from './check-catalog.js';
import { CONNECT_MAPPING_PATH } from './mapping.js';
import { MIGRATION_PAGES } from '../switches.js';
import { checkCatalog, renderCatalog } from './index.js';

const repo = createRepository(REPOSITORY_ROOT);

describe('renderCatalog', () => {
  const result = renderCatalog(repo);

  it('is built and renders the area generated pages, every one fresh', () => {
    expect(result.area).toBe('catalog');
    expect(result.status).toBe('built');
    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        CATALOG_PATH,
        API_README_PATH,
        // Q8 granted (2026-11-21): the committed switch selects the vendor-named page.
        MIGRATION_PAGES.vendorNamed,
        CONNECT_MAPPING_PATH,
      ]),
    );
    expect(staleFiles(repo, result.files)).toEqual([]);
  });

  it('reads a registered route, and so a scope or public, for every documented operation', () => {
    const page = result.files.find((file) => file.path === API_README_PATH)?.content ?? '';
    expect(page).toContain('| GET | `/api/v1/inquiries` |');
    expect(page).not.toContain('| not read |');
  });
});

describe('checkCatalog', () => {
  it('runs every check of the area and finds nothing wrong in the committed tree', () => {
    const results = checkCatalog(repo);
    expect(results.map((result) => result.name)).toEqual(
      expect.arrayContaining([
        'catalog-limits',
        'catalog-family-pages',
        'catalog-calibration',
        'catalog-fresh',
        'catalog-api-reference',
        'catalog-mapping',
        'catalog-connect-guide',
      ]),
    );
    for (const result of results) {
      expect(result.status, result.name).toBe('built');
      expect(result.findings, result.name).toEqual([]);
    }
  });
});

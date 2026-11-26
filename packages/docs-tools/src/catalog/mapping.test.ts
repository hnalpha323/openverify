/** C280 (switch on since Q8's grant, off in memory) and C281.1's mapping page: every source identifier has a row, and neither side changes without the table. */
import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { DOCS_SWITCHES, MIGRATION_PAGES } from '../switches.js';
import { vendorNameFindings } from '../vendor-name.js';
import { OPENAPI_PATH } from './api-reference.js';
import {
  CONNECT_MAPPING_PATH,
  SURFACE_PATH,
  mappingFindings,
  mappingRows,
  parseSurface,
  renderConnectMapping,
  renderMigration,
} from './mapping.js';
import { MAPPING_SECTIONS, REASON_CODES } from './mapping-data.js';

const repo = createRepository(REPOSITORY_ROOT);
const surfaceText = repo.readText(SURFACE_PATH);
const off = { ...DOCS_SWITCHES, vendorNaming: false };
const on = { ...DOCS_SWITCHES, vendorNaming: true };

describe('parseSurface', () => {
  const surface = parseSurface(surfaceText);

  it('reads the six machine sections, their subsections included, identifiers only', () => {
    expect(surface.sections.checks.map((item) => item.identifier)).toContain('id_glare_detection');
    expect(surface.sections.checks.map((item) => item.identifier)).toContain(
      'database_inquiry_comparison',
    );
    expect(surface.sections['verification-types'].map((item) => item.identifier)).toContain(
      'document/mdoc',
    );
    expect(surface.sections['list-item-types']).toHaveLength(11);
    expect(surface.sections.paths.length).toBeGreaterThan(180);
    for (const section of MAPPING_SECTIONS) {
      expect(surface.sections[section].every((item) => !item.identifier.includes(' '))).toBe(true);
    }
  });

  it('reads the four later prose sections as their own sections', () => {
    expect(surface.prose.map((section) => section.heading.split(' ')[0])).toEqual([
      'Signal,',
      'Template,',
      'Android',
      'Connect',
    ]);
    expect(surface.version).toBe('2026-09-29');
    expect(surface.prose.every((section) => section.intro.startsWith('Added '))).toBe(true);
  });
});

describe('mappingRows and mappingFindings (the real tree)', () => {
  const rows = mappingRows(repo);

  it('gives every identifier of every section a counterpart or a reason code', () => {
    const surface = parseSurface(surfaceText);
    const count = MAPPING_SECTIONS.reduce(
      (sum, section) => sum + surface.sections[section].length,
      0,
    );
    expect(rows).toHaveLength(count);
    for (const row of rows) {
      expect(
        row.counterpart !== null || row.reason !== null,
        `${row.section} ${row.identifier}`,
      ).toBe(true);
      if (row.reason !== null) {
        expect(REASON_CODES).toContain(row.reason);
      }
    }
    expect(mappingFindings(repo)).toEqual([]);
  });

  it('maps by the same id where OpenVerify has it', () => {
    const find = (identifier: string) => rows.find((row) => row.identifier === identifier);
    expect(find('id_glare_detection')?.counterpart).toBe('`id_glare_detection`');
    expect(find('watchlist')?.counterpart).toBe('`report/watchlist`');
    expect(find('government-ids')?.counterpart).toBe('`government_id`');
    expect(find('inquiries')?.counterpart).toBe('`/api/v1/inquiries`');
    expect(find('verification/selfies/{verification-id}')?.counterpart).toContain(
      '/api/v1/selfies/{id}',
    );
    expect(find('inquiry.reusable-persona-created')?.reason).toBe('vendor-retiring');
  });
});

describe('mappingFindings over fixtures: neither side changes without the table', () => {
  const openapi = JSON.stringify({ paths: { '/api/v1/inquiries': {} } });

  it('fails an identifier with no counterpart and no reason', () => {
    const fixture = createMemoryRepository({
      [SURFACE_PATH]:
        '# Source\n\n## API resources (path files) (2)\n\n- `inquiries`\n- `brand-new-things`\n',
      [OPENAPI_PATH]: openapi,
    });
    expect(mappingFindings(fixture).map((finding) => finding.message)).toContain(
      'paths brand-new-things has no counterpart and no reason',
    );
  });

  it('fails an entry the index no longer lists, and one an automatic rule now maps', () => {
    const fixture = createMemoryRepository({
      [SURFACE_PATH]: '# Source\n\n## API resources (path files) (1)\n\n- `oauth/token`\n',
      [OPENAPI_PATH]: JSON.stringify({ paths: { '/api/v1/oauth/token': {} } }),
    });
    const messages = mappingFindings(fixture).map((finding) => finding.message);
    expect(messages).toContain(
      'paths oauth/token has an entry its automatic rule now maps (stale)',
    );
    expect(messages).toContain(
      'paths oauth/authorize has an entry but the index no longer lists it',
    );
  });
});

describe('the migration page (C280)', () => {
  const page = renderMigration(repo, off);

  it('is the neutral page while the switch is off (rendered in memory; Q8 declined would ship it)', () => {
    expect(page?.path).toBe(MIGRATION_PAGES.neutral);
    expect(renderMigration(repo, off)?.content).toBe(page?.content);
    expect(vendorNameFindings(MIGRATION_PAGES.neutral, page?.content ?? '', off)).toEqual([]);
  });

  it('is the vendor-named page under the committed switch (Q8 granted), equal to a fresh render', () => {
    const committed = renderMigration(repo, DOCS_SWITCHES);
    expect(DOCS_SWITCHES.vendorNaming).toBe(true);
    expect(committed?.path).toBe(MIGRATION_PAGES.vendorNamed);
    expect(committed?.content).toContain(
      'OpenVerify is not affiliated with, endorsed by or sponsored by the vendor',
    );
    expect(staleFiles(repo, committed === null ? [] : [committed])).toEqual([]);
    expect(repo.exists(MIGRATION_PAGES.neutral)).toBe(false);
  });

  it('names no vendor while the switch is off, and says it is not affiliated', () => {
    const content = page?.content ?? '';
    expect(vendorNameFindings(MIGRATION_PAGES.neutral, content)).toEqual([]);
    expect(content).toContain('OpenVerify is not affiliated with');
    expect(content).toContain("the source API's version header");
  });

  it('has the concerns table, the migration notes, a table per section and the Connect table', () => {
    const content = page?.content ?? '';
    for (const heading of [
      '## Concerns',
      '## What does not migrate',
      '## Verification checks',
      '## Webhook events',
      '## API resources (path files)',
      '## Connect: scopes and entry points (C280.1)',
    ]) {
      expect(content).toContain(`\n${heading}\n`);
    }
    expect(content).toContain('never as passed checks');
    expect(content).toContain('`meta.share-token-id`');
  });

  it('moves to the vendor-named path and names the source only when the switch is on', () => {
    const named = renderMigration(repo, on);
    expect(named?.path).toBe(MIGRATION_PAGES.vendorNamed);
    expect(
      vendorNameFindings(MIGRATION_PAGES.vendorNamed, named?.content ?? '').length,
    ).toBeGreaterThan(0);
  });
});

describe('docs/connect/mapping.md (C281.1)', () => {
  // Under the committed switches (Q8 granted): it links the vendor-named migration page.
  const page = renderConnectMapping(repo, DOCS_SWITCHES);

  it('maps the eight Connect paths, names no vendor, and equals a fresh render', () => {
    expect(page?.path).toBe(CONNECT_MAPPING_PATH);
    const content = page?.content ?? '';
    expect(content.match(/^\| `connect\//gm)).toHaveLength(8);
    expect(content).not.toContain('| not available |');
    expect(content).toContain('(../migration/from-persona.md)');
    expect(vendorNameFindings(CONNECT_MAPPING_PATH, content)).toEqual([]);
    expect(
      vendorNameFindings(CONNECT_MAPPING_PATH, renderConnectMapping(repo, off)?.content ?? '', off),
    ).toEqual([]);
    expect(staleFiles(repo, page === null ? [] : [page])).toEqual([]);
  });
});

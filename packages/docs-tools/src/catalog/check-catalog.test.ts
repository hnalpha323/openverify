/** C279.1 and C279.2: the generated check catalog, its limits file and the family pages. */
import {
  CHECK_REGISTRY,
  REPORT_REGISTRY,
  SIGNAL_REGISTRY,
  VERIFICATION_TYPES,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { renderCatalog } from './index.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import {
  CATALOG_PATH,
  FAMILY_PAGES,
  LIMITS_PATH,
  familyPageFindings,
  limitsFindings,
  readLimits,
  renderCheckCatalog,
} from './check-catalog.js';

const repo = createRepository(REPOSITORY_ROOT);
const checkIds = CHECK_REGISTRY.map((check) => check.id);
const reportTypes = Object.keys(REPORT_REGISTRY);
const signalNames = SIGNAL_REGISTRY.map((signal) => signal.name);

describe('docs/checks/limits.json', () => {
  const limits = readLimits(repo);

  it('has exactly one entry per check id, report type and signal, each a sentence of its own', () => {
    expect(Object.keys(limits.checks).sort()).toEqual([...checkIds].sort());
    expect(Object.keys(limits.reports).sort()).toEqual([...reportTypes].sort());
    expect(Object.keys(limits.signals).sort()).toEqual([...signalNames].sort());
    for (const text of [
      ...Object.values(limits.checks),
      ...Object.values(limits.reports),
      ...Object.values(limits.signals),
    ]) {
      expect(text.trim().length).toBeGreaterThan(20);
      expect(text).toMatch(/\.$/);
    }
  });

  it('finds nothing wrong in the committed file', () => {
    expect(limitsFindings(repo)).toEqual([]);
  });

  it('names a missing entry, an unknown key and a file that is not the shape', () => {
    const entries = Object.fromEntries(
      checkIds.slice(1).map((id) => [id, 'A limit sentence here.']),
    );
    const fixture = createMemoryRepository({
      [LIMITS_PATH]: JSON.stringify({
        checks: { ...entries, not_a_check: 'Extra.' },
        reports: {},
        signals: {},
      }),
    });
    const messages = limitsFindings(fixture).map((finding) => finding.message);
    expect(messages).toContain(`no entry for check ${String(checkIds[0])}`);
    expect(messages).toContain('an entry for an unknown check not_a_check');
    expect(messages).toContain(`no entry for report type ${String(reportTypes[0])}`);
    expect(
      limitsFindings(createMemoryRepository({ [LIMITS_PATH]: '{"draft": "x"}' })).map(
        (finding) => finding.message,
      ),
    ).toContain('limits.json is not {checks, reports, signals} of strings');
  });
});

describe('the family pages (C279.1)', () => {
  it('maps every verification type to its frozen page', () => {
    expect(Object.keys(FAMILY_PAGES).sort()).toEqual([...VERIFICATION_TYPES].sort());
    expect(FAMILY_PAGES.government_id).toBe('docs/checks/government-id.md');
    expect(FAMILY_PAGES.aamva).toBe('docs/checks/database.md');
    expect(FAMILY_PAGES.business_website).toBe('docs/checks/business.md');
    expect(FAMILY_PAGES.email_address).toBe('docs/checks/contact.md');
  });

  it('each page mentions every id of its family', () => {
    expect(familyPageFindings(repo)).toEqual([]);
  });

  it('names an id its family page does not mention, as a word', () => {
    const pages = Object.fromEntries(
      [...new Set(Object.values(FAMILY_PAGES))].map((page) => [
        page,
        checkIds.map((id) => `\`${id}\``).join('\n'),
      ]),
    );
    pages['docs/checks/government-id.md'] = 'Only `id_blur_detection_extra` here.';
    const findings = familyPageFindings(createMemoryRepository(pages));
    expect(findings.map((finding) => finding.message)).toContain(
      'docs/checks/government-id.md does not mention id_blur_detection',
    );
    expect(findings.every((finding) => finding.path === 'docs/checks/government-id.md')).toBe(true);
  });
});

describe('docs/checks/catalog.md', () => {
  // The page as the area renders it under the committed switches (Q8 granted: the vendor-name
  // column is fed from the mapping's check rows, src/catalog/index.ts).
  const page =
    renderCatalog(repo).files.find((file) => file.path === CATALOG_PATH) ??
    renderCheckCatalog(repo);

  it('equals a fresh render (pnpm --filter @openverify/docs-tools docs:catalog writes it)', () => {
    expect(page.path).toBe(CATALOG_PATH);
    expect(staleFiles(repo, [page])).toEqual([]);
  });

  it('renders the same bytes twice, with no absolute path', () => {
    expect(renderCatalog(repo).files.find((file) => file.path === CATALOG_PATH)?.content).toBe(
      page.content,
    );
    expect(page.content).not.toContain(REPOSITORY_ROOT);
  });

  it('has one table per verification type, with every check of the type in it', () => {
    for (const type of VERIFICATION_TYPES) {
      expect(page.content).toContain(`\n## \`${type}\``);
    }
    for (const check of CHECK_REGISTRY) {
      expect(page.content).toContain(`\n| \`${check.id}\` |`);
    }
  });

  it('has a section per report type and a row per signal', () => {
    for (const type of reportTypes) {
      expect(page.content).toContain(`\n### \`${type}\``);
    }
    for (const name of signalNames) {
      expect(page.content).toContain(`\n| \`${name}\` |`);
    }
  });

  it('renders each limit from limits.json beside its id', () => {
    const limits = readLimits(repo);
    expect(page.content).toContain(limits.checks.id_glare_detection);
    expect(page.content).toContain(limits.signals['inquiry/tor_detected']);
  });

  it('prints the configuration keys with their defaults', () => {
    expect(page.content).toContain('`max-document-glare-ratio` 0.055');
    expect(page.content).toContain('`max-glare-ratio` (no default)');
    expect(page.content).toContain('`threshold` 0.394');
  });

  it('cites the calibration reports with their headline figures', () => {
    expect(page.content).toContain('(../calibration/government-id-phase3.md)');
    expect(page.content).toContain('(../calibration/selfie-phase4.md)');
    expect(page.content).toContain('## Calibration reports');
  });

  it('carries the DB-IP attribution, since it shows IP-derived locations', () => {
    expect(page.content).toContain('IP geolocation by [DB-IP](https://db-ip.com)');
  });

  it('renders the vendor-name column only when the switch is on (C279.2)', () => {
    // Q8 granted (2026-11-21): the committed page has the column; switched off it has none.
    expect(page.content).toContain('| Check | Source API name |');
    expect(
      renderCheckCatalog(repo, { switches: { vendorNaming: false, publishWired: false } }).content,
    ).not.toContain('Source API name');
    const on = renderCheckCatalog(repo, {
      switches: { vendorNaming: true, publishWired: false },
      vendorNames: { id_glare_detection: ['source_glare_name'] },
    });
    expect(on.content).toContain('| Check | Source API name |');
    expect(on.content).toContain('`source_glare_name`');
  });
});

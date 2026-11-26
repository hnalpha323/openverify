/**
 * C277.2: the configuration reference is generated from `apps/api/src/config-registry.ts`, every
 * entry with its description, default, secret flag, `_FILE` form and processes, the pattern
 * entries rendered as patterns; the committed page equals a fresh render (11B's
 * `config-registry.test.ts` already fails on an unregistered read, so nothing here scans sources).
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIG_PROCESSES,
  CONFIG_REGISTRY,
  type ConfigVariable,
} from '../../../../apps/api/src/config-registry.js';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import { CONFIGURATION_PAGE, renderConfigurationReference } from './configuration.js';

const FIXTURE: readonly ConfigVariable[] = [
  {
    name: 'OPENVERIFY_ZETA',
    description: 'Picks a | b, with a pipe in it.',
    default: '3000',
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'DATABASE_URL',
    description: 'The connection string.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker', 'api', 'migrate'],
  },
  {
    name: 'OPENVERIFY_PROVIDER_{KIND}_{MODE}',
    prefix: 'OPENVERIFY_PROVIDER_',
    description: 'A provider per kind and mode.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
];

/** The table rows of the section headed `heading`. */
function rowsOf(page: string, heading: string): string[] {
  const start = page.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = page.slice(start + heading.length + 5);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end))
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('| ') &&
        !line.startsWith('| Name') &&
        !line.startsWith('| Pattern') &&
        !line.startsWith('| Process'),
    );
}

describe('the configuration reference (C277.2)', () => {
  it('renders one row per exact name, sorted, with every field the registry holds', () => {
    const page = renderConfigurationReference(FIXTURE);
    const rows = rowsOf(page, 'Variables');

    expect(rows).toEqual([
      '| `DATABASE_URL` | The connection string. | unset | yes | `DATABASE_URL_FILE` | api, worker, migrate |',
      '| `OPENVERIFY_ZETA` | Picks a \\| b, with a pipe in it. | `3000` | no | none | api |',
    ]);
  });

  it('renders the pattern entries as patterns, with their fixed start', () => {
    const page = renderConfigurationReference(FIXTURE);

    expect(rowsOf(page, 'Names composed at run time')).toEqual([
      '| `OPENVERIFY_PROVIDER_{KIND}_{MODE}` | `OPENVERIFY_PROVIDER_` | A provider per kind and mode. | unset | no | none | api, worker |',
    ]);
    expect(rowsOf(page, 'Variables').join('\n')).not.toContain('{KIND}');
  });

  it('counts each process’s names and secrets, in the registry’s process order', () => {
    const page = renderConfigurationReference(FIXTURE);
    const rows = rowsOf(page, 'Processes');

    expect(rows).toHaveLength(CONFIG_PROCESSES.length);
    expect(rows[0]).toMatch(/^\| `api` \| .+ \| 3 \| 1 \|$/);
    expect(rows[1]).toMatch(/^\| `worker` \| .+ \| 2 \| 1 \|$/);
    expect(rows[2]).toMatch(/^\| `migrate` \| .+ \| 1 \| 1 \|$/);
    expect(rows[3]).toMatch(/^\| `dashboard` \| .+ \| 0 \| 0 \|$/);
  });

  it('says it is generated, from where, and how to re-render it', () => {
    const page = renderConfigurationReference(FIXTURE);

    expect(page.startsWith('# Configuration reference\n')).toBe(true);
    expect(page).toContain('`apps/api/src/config-registry.ts`');
    expect(page).toContain('pnpm --filter @openverify/docs-tools docs:selfhost');
    expect(page).toContain('3 entries: 2 names and 1 pattern');
    expect(page.endsWith('\n')).toBe(true);
    expect(page.endsWith('\n\n')).toBe(false);
  });

  it('renders the same bytes twice, whatever order the registry lists its entries in', () => {
    expect(renderConfigurationReference([...FIXTURE].reverse())).toBe(
      renderConfigurationReference(FIXTURE),
    );
  });

  it('renders every entry of the real registry exactly once', () => {
    const page = renderConfigurationReference();

    for (const entry of CONFIG_REGISTRY) {
      expect(page.split(`| \`${entry.name}\` |`)).toHaveLength(2);
    }
    expect(page).toContain(`${String(CONFIG_REGISTRY.length)} entries`);
  });

  it('is committed as a fresh render', () => {
    const repo = createRepository(REPOSITORY_ROOT);

    expect(
      staleFiles(repo, [{ path: CONFIGURATION_PAGE, content: renderConfigurationReference() }]),
    ).toEqual([]);
  });
});

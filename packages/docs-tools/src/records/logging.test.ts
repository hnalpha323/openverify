/**
 * C276.3 (Workflow 11E, `docs-records`): the logging inventory's documented redaction paths equal
 * each logger's configured list (`REDACT_PATHS` and `PERSONAL_LOG_KEYS`, `apps/api/src/logger.ts`;
 * `WORKER_REDACT_PATHS`, `apps/api/src/jobs/logger.ts`), and the page names every process and
 * every key a stored API log redacts.
 */
import { API_LOG_REDACTED_KEYS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { CONFIG_PROCESSES } from '../../../../apps/api/src/config-registry.js';
import { WORKER_REDACT_PATHS } from '../../../../apps/api/src/jobs/logger.js';
import { PERSONAL_LOG_KEYS, REDACT_PATHS } from '../../../../apps/api/src/logger.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { codeSpans } from './checks.js';
import {
  LOGGING_PATH,
  LOGGING_TABLE_HEADINGS,
  checkLogging,
  documentedRedactionPaths,
} from './logging.js';

const repo = createRepository(REPOSITORY_ROOT);

describe('a redaction table', () => {
  const page = [
    '# Logging',
    '',
    LOGGING_TABLE_HEADINGS.api,
    '',
    '| Keys | Where | Why |',
    '|---|---|---|',
    '| `pii` | top level, `*.`, `*.*.` | nested personal data |',
    '| `headers.cookie`, `headers["set-cookie"]` | `req.`, `res.` | credentials |',
    '',
    '## Next',
    '',
    '| `not-this` | top level | outside the section |',
  ].join('\n');

  it('expands each row to its prefixes, the top level being no prefix', () => {
    expect([...documentedRedactionPaths(page, LOGGING_TABLE_HEADINGS.api)].sort()).toEqual(
      [
        'pii',
        '*.pii',
        '*.*.pii',
        'req.headers.cookie',
        'res.headers.cookie',
        'req.headers["set-cookie"]',
        'res.headers["set-cookie"]',
      ].sort(),
    );
  });

  it('reads nothing under a heading the page does not have', () => {
    expect(documentedRedactionPaths(page, LOGGING_TABLE_HEADINGS.worker)).toEqual([]);
  });
});

describe('the committed logging inventory', () => {
  const text = repo.readText(LOGGING_PATH);

  it("documents exactly the API's configured redaction paths", () => {
    const documented = documentedRedactionPaths(text, LOGGING_TABLE_HEADINGS.api);
    expect(new Set(documented).size).toBe(documented.length);
    expect([...documented].sort()).toEqual([...REDACT_PATHS].sort());
  });

  it("documents exactly the worker's own redaction paths", () => {
    const documented = documentedRedactionPaths(text, LOGGING_TABLE_HEADINGS.worker);
    expect(new Set(documented).size).toBe(documented.length);
    expect([...documented].sort()).toEqual([...WORKER_REDACT_PATHS].sort());
  });

  it('names every PERSONAL_LOG_KEYS key, every stored-log redacted key and every process', () => {
    const spans = codeSpans(text);
    for (const name of [...PERSONAL_LOG_KEYS, ...API_LOG_REDACTED_KEYS, ...CONFIG_PROCESSES]) {
      expect(spans, name).toContain(name);
    }
  });

  it('passes its record test', () => {
    const result = checkLogging(repo);
    expect(result.status).toBe('built');
    expect(result.findings).toEqual([]);
  });

  it('fails a page whose table lost a path', () => {
    const fixture = createMemoryRepository({
      [LOGGING_PATH]: [LOGGING_TABLE_HEADINGS.api, '', '| `pii` | top level | x |'].join('\n'),
    });
    const messages = checkLogging(fixture)
      .findings.map((finding) => finding.message)
      .join('\n');
    expect(messages).toContain('*.pii');
    expect(messages).toContain('embedding');
  });
});

/**
 * C276.5 (Workflow 11E, `docs-records`): `docs/security/README.md` indexes every `docs/security/`
 * document, docs-security's included, and states the wording rule of C274.5.
 */
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { SECURITY_INDEX_PATH, checkSecurityIndex, securityDocuments } from './security-index.js';

const repo = createRepository(REPOSITORY_ROOT);

describe('the security index', () => {
  it('knows every document beside it', () => {
    const documents = securityDocuments(repo);
    for (const name of [
      'docs/security/threat-model.md',
      'docs/security/asvs-5.0.0-l2.csv',
      'docs/security/masvs-2.1.0.csv',
      'docs/security/crypto-inventory.md',
      'docs/security/data-classification.md',
      'docs/security/logging.md',
      'docs/security/vulnerability-policy.md',
    ]) {
      expect(documents, name).toContain(name);
    }
    expect(documents).not.toContain(SECURITY_INDEX_PATH);
  });

  it('passes its record test', () => {
    const result = checkSecurityIndex(repo);
    expect(result.status).toBe('built');
    expect(result.findings).toEqual([]);
  });

  it('fails an index that misses a document or the wording rule', () => {
    const fixture = createMemoryRepository({
      [SECURITY_INDEX_PATH]: '# Security records\n\n- [Logging](logging.md)\n',
      'docs/security/logging.md': '# Logging\n',
      'docs/security/new-record.md': '# New\n',
    });
    const messages = checkSecurityIndex(fixture)
      .findings.map((finding) => finding.message)
      .join('\n');
    expect(messages).toContain('new-record.md');
    expect(messages).toContain('C274.5');
  });
});

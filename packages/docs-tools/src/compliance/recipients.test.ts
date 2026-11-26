import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import { renderCompliance } from './index.js';
import { COUNSEL_LINE, RECIPIENTS_PAGE } from './pages.js';
import { PROVIDER_FACTS, type ProviderFacts } from './provider-facts.js';
import { RECIPIENT_DETAILS, renderRecipientsPage } from './recipients.js';

const FIXTURE: ProviderFacts = {
  kinds: ['sms', 'registry', 'onlySandbox'],
  prefixes: {
    sms: 'OPENVERIFY_PROVIDER_SMS',
    registry: 'OPENVERIFY_PROVIDER_REGISTRY',
    onlySandbox: 'OPENVERIFY_PROVIDER_ONLY_SANDBOX',
  },
  namesByKind: {
    sms: ['twilio', 'sandbox'],
    registry: ['gleif', 'sandbox'],
    onlySandbox: ['sandbox'],
  },
  apiKinds: ['sms'],
  unsetDefaults: { sms: null, registry: ['gleif'], onlySandbox: null },
  widenedDefaults: {
    OPENVERIFY_SEC_EDGAR_USER_AGENT: {
      sms: null,
      registry: ['gleif', 'sec-edgar'],
      onlySandbox: null,
    },
  },
  sandbox: 'sandbox',
};

describe('the recipient list (C278.2)', () => {
  it('describes exactly the real provider names the registry holds', () => {
    const real = new Set(
      Object.values(PROVIDER_FACTS.namesByKind)
        .flat()
        .filter((name) => name !== PROVIDER_FACTS.sandbox),
    );
    expect(Object.keys(RECIPIENT_DETAILS).sort()).toEqual([...real].sort());
  });

  it('reads 22 kinds, two of them bound when unset', () => {
    expect(PROVIDER_FACTS.kinds).toHaveLength(22);
    const bound = PROVIDER_FACTS.kinds.filter((kind) => PROVIDER_FACTS.unsetDefaults[kind] != null);
    expect(bound.sort()).toEqual(['businessRegistry', 'domainAge']);
  });

  it('renders a kind row with its variable, its readers and what unset binds', () => {
    const page = renderRecipientsPage(FIXTURE);
    expect(page).toContain(COUNSEL_LINE);
    expect(page).toContain(
      '| `sms` | `OPENVERIFY_PROVIDER_SMS_{SANDBOX,PRODUCTION}` | API and worker | `twilio`, `sandbox` | unbound |',
    );
    expect(page).toContain(
      '| `registry` | `OPENVERIFY_PROVIDER_REGISTRY_{SANDBOX,PRODUCTION}` | worker | `gleif`, `sandbox` | `gleif`; plus `sec-edgar` with `OPENVERIFY_SEC_EDGAR_USER_AGENT` set |',
    );
    expect(page).toContain('| `onlySandbox` |');
    expect(page).toContain('`onlySandbox`: no real adapter in this version');
  });

  it('renders a row for each real adapter and refuses a name it cannot describe', () => {
    const page = renderRecipientsPage(FIXTURE);
    expect(page).toMatch(/^\| `twilio` \| `sms` \| /m);
    expect(() =>
      renderRecipientsPage({
        ...FIXTURE,
        namesByKind: { ...FIXTURE.namesByKind, sms: ['unknown'] },
      }),
    ).toThrow('no recipient detail for the provider name unknown');
  });

  it('renders the same bytes twice', () => {
    expect(renderRecipientsPage(PROVIDER_FACTS)).toBe(renderRecipientsPage(PROVIDER_FACTS));
  });

  it('is committed exactly as a fresh render', () => {
    const repo = createRepository(REPOSITORY_ROOT);
    const result = renderCompliance(repo);
    expect(result.status).toBe('built');
    expect(result.files.map((file) => file.path)).toContain(RECIPIENTS_PAGE);
    expect(staleFiles(repo, result.files)).toEqual([]);
  });
});

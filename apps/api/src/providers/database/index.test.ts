import { describe, expect, it } from 'vitest';
import { createDatabaseProvider } from './index.js';

// C59.1, C63: `sandbox` is the only database provider this version ships (C59.2).
describe('createDatabaseProvider', () => {
  it('binds the sandbox provider, which answers with a record that is not authoritative', async () => {
    const provider = createDatabaseProvider('sandbox');

    expect({ id: provider.id, sandbox: provider.sandbox }).toEqual({
      id: 'sandbox',
      sandbox: true,
    });
    await expect(
      provider.lookup(
        { country: 'US', fields: { 'name-first': 'Synthia', 'name-last': 'Testerton' } },
        { referenceId: null },
      ),
    ).resolves.toEqual({
      outcome: 'found',
      record: { 'name-first': 'Synthia', 'name-last': 'Testerton' },
      authoritative: false,
    });
  });
});

/**
 * C208.1, C208.4 (Workflow 10C Stage 1a, `contracts-10c`): a `government-id-nfc` verification read
 * from a sandbox test chip says so in its attributes (`sandbox-chip: <scenario>`), so the
 * verification and the console can label it "Test chip (sandbox)". The scenario is what
 * `api-nfc`'s `sandboxChipLabelOf` (`services/sandbox-chip.ts`) answers, replaced here so this file
 * proves the call site; a verification read from any other chip has no such member.
 */
import { verificationDocumentSchema } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { sandboxChipLabelOf } from '../sandbox-chip.js';

vi.mock('../sandbox-chip.js', async (original) => ({
  ...(await original<typeof import('../sandbox-chip.js')>()),
  sandboxChipLabelOf: vi.fn(() => Promise.resolve(null)),
}));

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

async function served(): Promise<{ id: string; attributes: Record<string, unknown> }> {
  const inquiry = await createInquiry(api);
  const { id } = await seedVerification(api, api.environmentId, inquiry, {
    type: 'government_id_nfc',
  });
  const body = expectStatus(
    await api.app.inject({ url: `/api/v1/verifications/${id}`, headers: bearer(api.token) }),
    200,
  );
  expect(verificationDocumentSchema.safeParse(body).success).toBe(true);
  return { id, attributes: (body.data as { attributes: Record<string, unknown> }).attributes };
}

describe('the sandbox-chip attribute of a government-id-nfc verification (C208.4)', () => {
  it('serves the scenario the hook answers, asked with the verification', async () => {
    const hook = vi.mocked(sandboxChipLabelOf);
    hook.mockClear();
    hook.mockResolvedValue('mrz-mismatch');

    const { id, attributes } = await served();

    expect(attributes['sandbox-chip']).toBe('mrz-mismatch');
    expect(hook.mock.calls.at(-1)?.[1]).toMatchObject({ id, environmentId: api.environmentId });
  });

  it('has no such member for a verification read from any other chip', async () => {
    vi.mocked(sandboxChipLabelOf).mockResolvedValue(null);

    const { attributes } = await served();

    expect(attributes).not.toHaveProperty('sandbox-chip');
  });
});

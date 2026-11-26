/**
 * C90.5, V06 (Workflow 7B Stage 1b (L)): every inquiry read gives `servedInquirySignals` the
 * inquiry's `list_screenings` row, which `api-lists` merges into `inquiry/list_match_count`: the
 * server API's read and list, an inquiry event, and the console's read and list. Recorded by a thin
 * wrapper over the real function, which serves no entry until `api-lists` builds the merge.
 */
import { createListScreening } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardHarness, expectJson } from '../routes/dashboard/dashboard.test-support.js';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

const seen = vi.hoisted(() => [] as (string | null)[]);
vi.mock('./signals/served.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./signals/served.js')>();
  return {
    ...original,
    servedInquirySignals: (...args: Parameters<typeof original.servedInquirySignals>) => {
      seen.push(args[0].listScreening?.status ?? null);
      return original.servedInquirySignals(...args);
    },
  };
});

let api: InquiryTestApi;
let screened: string;
let unscreened: string;

beforeAll(async () => {
  api = await createInquiryTestApi();
  screened = await createInquiry(api, {});
  unscreened = await createInquiry(api, {});
  await createListScreening(api.database.db, api.environmentId, {
    inquiryId: screened,
    triggerStatus: 'completed',
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  seen.length = 0;
});

describe('the server API reads (C90.5)', () => {
  it('GET /inquiries/:id passes the row, and null without one', async () => {
    expectStatus(
      await api.app.inject({ url: `/api/v1/inquiries/${screened}`, headers: bearer(api.token) }),
      200,
    );
    expect(seen).toEqual(['pending']);
    seen.length = 0;

    expectStatus(
      await api.app.inject({ url: `/api/v1/inquiries/${unscreened}`, headers: bearer(api.token) }),
      200,
    );
    expect(seen).toEqual([null]);
  });

  it('GET /inquiries passes each page row its own screening', async () => {
    expectStatus(
      await api.app.inject({ url: '/api/v1/inquiries', headers: bearer(api.token) }),
      200,
    );

    expect([...seen].sort()).toEqual(['pending', null].sort());
  });
});

describe('the console reads (C90.8)', () => {
  it('reads and lists with the row', async () => {
    const harness = await createDashboardHarness(api.database);
    try {
      const organization = await harness.organization();
      const admin = await harness.operator(organization, { roles: ['admin'] });
      const token = await harness.signIn(admin.email);
      const { inquiry } = await createTestInquiry(api.database.db, organization.sandboxId);
      await createListScreening(api.database.db, organization.sandboxId, {
        inquiryId: inquiry.id,
        triggerStatus: 'failed',
      });
      seen.length = 0;

      expectJson(await harness.call('GET', '/inquiries', { token }), 200);
      expect(seen).toEqual(['pending']);
      seen.length = 0;

      expectJson(await harness.call('GET', `/inquiries/${inquiry.id}`, { token }), 200);
      expect(seen).toEqual(['pending']);
    } finally {
      await harness.close();
    }
  });
});

// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { device } from '../../testing/signals-fixtures';
import { setDeviceTrust } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const INQUIRY = 'inq_01MB0000000000000000000009';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  vi.mocked(revalidatePath).mockClear();
});

afterEach(() => {
  api.restore();
});

const as = (...permissions: Permission[]) => api.me({ permissions });
const DEVICE = device();
const PATH = `/devices/${DEVICE.id}/trust`;
const trustForm = (values: Record<string, string>) => {
  const data = new FormData();
  data.set('device-id', DEVICE.id);
  data.set('inquiry-id', INQUIRY);
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

describe('setDeviceTrust (C127.9)', () => {
  it('trusts the device with its reason code under devices:write, refreshing the inquiry', async () => {
    as('inquiry-sessions:read', 'devices:write');
    api.on('POST', PATH, 200, { data: DEVICE });

    const result = await setDeviceTrust(
      null,
      trustForm({ mode: 'trust', 'trust-reason': 'known_customer_device' }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', PATH)?.body).toEqual({
      meta: { 'trust-reason': 'known_customer_device' },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${INQUIRY}`);
  });

  it('clears the mark with untrust', async () => {
    as('inquiry-sessions:read', 'devices:write');
    api.on('POST', PATH, 200, { data: DEVICE });

    await setDeviceTrust(null, trustForm({ mode: 'untrust' }));

    expect(api.find('POST', PATH)?.body).toEqual({ meta: { untrust: true } });
  });

  it('refuses a reason that is not a snake_case code at its pointer, never echoing it', async () => {
    as('inquiry-sessions:read', 'devices:write');

    const result = await setDeviceTrust(
      null,
      trustForm({ mode: 'trust', 'trust-reason': 'Jane Doe uses it' }),
    );

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/meta/trust-reason',
    ]);
    expect(JSON.stringify(result)).not.toContain('Jane');
    expect(api.all('POST', PATH)).toHaveLength(0);
  });

  it('needs devices:write', async () => {
    as('inquiry-sessions:read');

    expect((await setDeviceTrust(null, trustForm({ mode: 'untrust' }))).ok).toBe(false);
    expect(api.all('POST', PATH)).toHaveLength(0);
  });
});

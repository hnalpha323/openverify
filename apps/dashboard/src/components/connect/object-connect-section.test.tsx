import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { ToastProvider } from '../toasts';
import {
  CLONE_PROVENANCE,
  CONSENT_EVIDENCE,
  HYDRATE_PROVENANCE,
  consentRecord,
} from './connect-fixtures';
import { ObjectConnectSection, type ObjectConnectSectionProps } from './object-connect-section';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('./consent-actions', () => ({ withdrawConsentRecordAction: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const SUBJECT = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const LIST = '/connect/consent-records';
const READER: readonly Permission[] = ['inquiries:read', 'connect-share-tokens:read'];
type SectionInput = Omit<Partial<ObjectConnectSectionProps>, 'permissions'> & {
  readonly permissions: readonly Permission[];
};
const section = ({ permissions, ...props }: SectionInput) =>
  ObjectConnectSection({ subjectId: SUBJECT, ...props, permissions: new Set(permissions) });
const show = async (node: Promise<ReactNode>) =>
  render(<ToastProvider>{await node}</ToastProvider>);
const list = (records: readonly ReturnType<typeof consentRecord>[]) => ({
  data: records,
  links: { next: null },
});

describe('an object’s Connect slot (C242.3, C242.4)', () => {
  it('lists the object’s consent records, both sides, by its subject id', async () => {
    api.on('GET', LIST, 200, list([consentRecord('source-flow'), consentRecord('declined')]));

    await show(section({ permissions: READER }));

    expect(api.find('GET', LIST)?.query.get('filter[subject-id]')).toBe(SUBJECT);
    expect(api.find('GET', LIST)?.query.get('page[size]')).toBe('100');
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('is empty without Connect’s read, or when Connect is off, or when there is nothing to show', async () => {
    expect(await section({ permissions: ['inquiries:read'] })).toBeNull();
    expect(api.all('GET', LIST)).toHaveLength(0);

    api.onProblem('GET', LIST, 404);
    expect(await section({ permissions: READER })).toBeNull();

    api.on('GET', LIST, 200, list([]));
    expect(await section({ permissions: READER })).toBeNull();
  });

  it('says the API refused the records, and still shows the banner', async () => {
    api.onProblem('GET', LIST, 403);

    await show(section({ permissions: READER, provenance: CLONE_PROVENANCE }));

    expect(screen.getByText('Cloned from Example Source')).toBeInTheDocument();
    expect(
      screen.getByText(/You do not have access to this object’s consent records/),
    ).toBeInTheDocument();
  });

  it('shows a cloned inquiry’s banner and marks each of its verifications Cloned, without Connect’s read', async () => {
    await show(
      section({
        permissions: ['inquiries:read'],
        provenance: CLONE_PROVENANCE,
        verifications: [
          {
            id: 'ver_01M5CN0000000000000011A700',
            type: 'verification/government-id',
            status: 'passed',
          },
          { id: 'ver_01M5CN0000000000000011A701', type: 'verification/selfie', status: 'failed' },
        ],
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Cloned from Example Source');
    const rows = within(screen.getByRole('table', { name: 'Cloned verifications' })).getAllByRole(
      'row',
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Government ID');
    expect(rows[1]).toHaveTextContent('Cloned');
    expect(rows[2]).toHaveTextContent('Failed');
    expect(api.all('GET', LIST)).toHaveLength(0);
  });

  it('lists the hydrated fields of a filled object with their token', async () => {
    await show(section({ permissions: ['inquiries:read'], provenance: HYDRATE_PROVENANCE }));

    expect(screen.getByRole('status')).toHaveTextContent('birthdate and name_first');
    expect(screen.queryByRole('table', { name: 'Cloned verifications' })).toBeNull();
  });

  it('offers the withdrawal only with connect-share-tokens:write', async () => {
    api.on('GET', LIST, 200, list([consentRecord('source-flow')]));
    const { unmount } = await show(section({ permissions: READER }));
    expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
    unmount();

    await show(section({ permissions: PERMISSIONS }));
    expect(screen.getByRole('button', { name: /Withdraw/ })).toBeInTheDocument();
  });
});

describe('what the slot sends the browser (C242.5)', () => {
  it('sends the evidence and the stored text only as the API served them to pii:view', async () => {
    api.on('GET', LIST, 200, list([consentRecord('source-flow')]));
    const masked = await rscPayloadOf(await section({ permissions: READER }));
    for (const value of Object.values(CONSENT_EVIDENCE)) {
      expect(masked).not.toContain(value);
    }

    api.on('GET', LIST, 200, list([consentRecord('source-flow', CONSENT_EVIDENCE)]));
    const served = await rscPayloadOf(await section({ permissions: PERMISSIONS }));
    expect(served).toContain(CONSENT_EVIDENCE['ip-address']);
  });
});

/**
 * Workflow 9A Stage 1b, checkpoint (F): the embed route's slot and the in-memory flow API's
 * registration hook (C157.1, C159.4; review F11). `flow-server-embed` built the embed entry: a
 * malformed `/embed/{inquiry id}` shows the not-found page every unknown path shows, never the flow.
 */
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as embedEntry from './embed/embed-entry';
import { createI18n } from './i18n/create-i18n';
import { FlowRoutes, type FlowStart } from './routes';
import { FakeFlowApi } from './testing/fake-flow-api';
import { registerFakeFlowExtension } from './testing/fake-flow-registry';
import { INQUIRY_ID } from './testing/flow-fixtures';

vi.mock('./embed/embed-entry', { spy: true });

afterEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string, start: FlowStart) {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <MemoryRouter initialEntries={[path]}>
        <FlowRoutes start={start} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('the embed route (C157.1, C159.4)', () => {
  it('mounts the embed entry, which runs the flow for a well-formed id (built by flow-server-embed)', async () => {
    const api = new FakeFlowApi();

    renderAt(`/embed/${INQUIRY_ID}`, {
      status: 'ready',
      inquiryId: INQUIRY_ID,
      client: api.client,
    });

    await vi.waitFor(() => {
      expect(api.client.getSession).toHaveBeenCalled();
    });
    expect(embedEntry.EmbedEntry).toHaveBeenCalled();
  });

  it('shows the not-found page for a malformed id, never the flow', async () => {
    const api = new FakeFlowApi();

    renderAt('/embed/inq_short', { status: 'ready', inquiryId: INQUIRY_ID, client: api.client });

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(api.client.getSession).not.toHaveBeenCalled();
  });
});

describe('the in-memory flow API’s registration hook (review F11)', () => {
  it('applies each registered area’s session members and client methods, until removed', async () => {
    const probe = vi.fn(() => Promise.resolve('probed'));
    const remove = registerFakeFlowExtension('registry-probe', {
      session: (session, fake) => ({
        ...session,
        inquiry: {
          ...session.inquiry,
          status: fake.inquiryStatus === 'pending' ? 'completed' : 'failed',
        },
      }),
      client: () => ({ getVerification: probe as never }),
    });
    try {
      const fake = new FakeFlowApi();

      const session = await fake.client.getSession();

      expect(session.inquiry.status).toBe('completed');
      expect(fake.client.getVerification).toBe(probe);
    } finally {
      remove();
    }
    const plain = new FakeFlowApi();
    expect((await plain.client.getSession()).inquiry.status).toBe('pending');
  });
});

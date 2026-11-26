/**
 * C157.1, C158.3, C159.4 (Workflow 9A, flow-server-embed): `/embed/{inquiry id}` renders the flow
 * only for a well-formed id, shows its link error when the session's inquiry (the server's truth)
 * is another one, and tells the bridge each session and each final failure the flow meets.
 */
import { screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowApiError, type FlowApiClient } from '../api/flow-api-client';
import type { FlowStart } from '../routes';
import { renderWithI18n } from '../test-utils';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID } from '../testing/flow-fixtures';
import * as bridge from './bridge';
import { EmbedEntry, observeFlowClient } from './embed-entry';

vi.mock('./bridge', { spy: true });

const OTHER_INQUIRY = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

afterEach(() => {
  vi.clearAllMocks();
});

/** A stand-in for the route's `<Start start={start} />`: it reads the session once. */
function FakeStart({ start }: { readonly start: FlowStart }) {
  const [text, setText] = useState('loading');
  useEffect(() => {
    if (start.status !== 'ready') {
      return;
    }
    start.client.getSession().then(
      (session) => {
        setText(`session of ${session.inquiry.id}`);
      },
      () => {
        setText('session failed');
      },
    );
  }, [start]);
  return <p>{text}</p>;
}

function renderEntry(path: string, start: FlowStart | null) {
  const flow = start === null ? <p>an element without a start</p> : <FakeStart start={start} />;
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="embed/:inquiryId"
          element={<EmbedEntry flow={flow} fallback={<p>not found</p>} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const ready = (client: FlowApiClient, inquiryId = INQUIRY_ID): FlowStart => ({
  status: 'ready',
  inquiryId,
  client,
});

describe('EmbedEntry (C158.3)', () => {
  it('renders the flow and reports its session when the path names the session’s inquiry', async () => {
    const fake = new FakeFlowApi();
    renderEntry(`/embed/${INQUIRY_ID}`, ready(fake.client));

    expect(await screen.findByText(`session of ${INQUIRY_ID}`)).toBeInTheDocument();
    expect(bridge.reportEmbedSession).toHaveBeenCalledWith(
      expect.objectContaining({ inquiryId: INQUIRY_ID }),
    );
  });

  it("shows the link error when the session's inquiry is not the path's", async () => {
    const fake = new FakeFlowApi();
    renderEntry(`/embed/${OTHER_INQUIRY}`, ready(fake.client));

    expect(
      await screen.findByText(
        'This link belongs to a different verification. Open the latest link you received.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(`session of ${INQUIRY_ID}`)).not.toBeInTheDocument();
  });

  it('renders the not-found page for a malformed id, and for a flow it cannot observe', () => {
    const fake = new FakeFlowApi();
    renderEntry('/embed/inq_short', ready(fake.client));
    expect(screen.getByText('not found')).toBeInTheDocument();
    expect(fake.client.getSession).not.toHaveBeenCalled();
  });

  it('fails closed for a flow element it cannot observe', () => {
    renderEntry(`/embed/${INQUIRY_ID}`, null);
    expect(screen.getByText('not found')).toBeInTheDocument();
  });

  it('reports a session that can never go on as unauthenticated', async () => {
    const fake = new FakeFlowApi();
    fake.client.getSession.mockRejectedValue(
      new FlowApiError('http', 'expired', {
        status: 401,
        problem: {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'The session expired.',
          instance: '/api/v1/flow/session',
          requestId: '00000000-0000-4000-8000-000000000000',
          code: 'session_expired',
        },
      }),
    );
    renderEntry(`/embed/${INQUIRY_ID}`, ready(fake.client));

    expect(await screen.findByText('session failed')).toBeInTheDocument();
    expect(bridge.reportEmbedError).toHaveBeenCalledWith('unauthenticated');
  });

  it('observes the client a one-time link connects to', async () => {
    const fake = new FakeFlowApi();
    const start: FlowStart = {
      status: 'one-time-link',
      inquiryId: INQUIRY_ID,
      redeem: () => Promise.resolve({ sessionToken: 'ovs_x' }),
      connect: () => fake.client,
    };
    renderEntry(`/embed/${INQUIRY_ID}`, start);
    await waitFor(() => {
      expect(screen.getByText('loading')).toBeInTheDocument();
    });
    expect(screen.queryByText('not found')).not.toBeInTheDocument();
  });
});

describe('observeFlowClient', () => {
  it('passes every call through, showing sessions and failures to the observer', async () => {
    const fake = new FakeFlowApi();
    const observer = { session: vi.fn(), error: vi.fn() };
    const client = observeFlowClient(fake.client, observer);

    const session = await client.getSession();
    expect(session).toBe(await fake.client.getSession.mock.results[0]?.value);
    expect(session.inquiry.id).toBe(INQUIRY_ID);
    expect(observer.session).toHaveBeenCalledWith(session);
    expect(Object.keys(client).sort()).toEqual(Object.keys(fake.client).sort());

    const failure = new Error('network');
    fake.client.getSession.mockRejectedValueOnce(failure);
    await expect(client.getSession()).rejects.toBe(failure);
    expect(observer.error).toHaveBeenCalledWith(failure);
  });
});

/**
 * C94.3, C94.6 (Workflow 7A Stage 1b (S), F06, P14): `FlowRenderer` starts the signal collection
 * (`startSignalCollection`, `client-collector`'s) only once the session reports its consent, with
 * the tiers `GET /flow/session` reports (`null` when it may not collect) and a `send` that posts
 * through the client; tells it each screen the person reaches after consent; and stops it when
 * the flow unmounts. Before consent nothing is started at all.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalCollectionOptions } from '../signals';
import { fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { FlowRenderer } from './flow-renderer';

const collection = vi.hoisted(() => ({
  started: [] as SignalCollectionOptions[],
  screens: [] as string[],
  stopped: 0,
  flushed: 0,
}));

vi.mock('../signals', () => ({
  startSignalCollection: (options: SignalCollectionOptions) => {
    collection.started.push(options);
    return {
      collecting: options.tiers !== null,
      screen: (stepId: string) => {
        collection.screens.push(stepId);
      },
      stop: () => {
        collection.stopped += 1;
      },
      flush: () => {
        collection.flushed += 1;
        return Promise.resolve();
      },
    };
  },
}));

beforeEach(() => {
  collection.started.length = 0;
  collection.screens.length = 0;
  collection.stopped = 0;
  collection.flushed = 0;
});

function renderFlow(api: FakeFlowApi) {
  const camera = fakeCamera();
  return renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />, {
    environment: camera.environment,
  });
}

async function giveConsent() {
  await userEvent.click(await screen.findByRole('checkbox', { name: /^I agree/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

const CONSENT_TITLE = 'Consent to use your biometric data';

describe('FlowRenderer: the signal collection (C94.3, C94.6)', () => {
  it('starts nothing before consent', async () => {
    const api = new FakeFlowApi();
    api.signalTiers = { integrity: true, recognition: false };

    renderFlow(api);
    await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE });

    expect(collection.started).toEqual([]);
    expect(collection.screens).toEqual([]);
  });

  it('starts after consent with the reported tiers, tells it each screen, and posts through the client', async () => {
    const api = new FakeFlowApi();
    api.signalTiers = { integrity: true, recognition: false };
    renderFlow(api);

    await giveConsent();
    await screen.findByRole('heading', { level: 1, name: 'Photograph your ID' });

    expect(collection.started).toHaveLength(1);
    const [options] = collection.started;
    expect(options?.tiers).toEqual({ integrity: true, recognition: false });
    expect(options?.platform).toBe('web');
    expect(collection.screens).toEqual(['government_id']);
    const body = {
      platform: 'web',
      'collector-version': 1,
      screen: 'government_id',
      sequence: 0,
    } as const;
    await options?.send(body);
    expect(api.client.sendSignals.mock.calls.map(([sent]) => sent)).toEqual([body]);
    expect(api.signalBodies).toEqual([body]);
  });

  it('starts at the session’s next sequence, and a refreshed sequence keeps the collection (K7A-7)', async () => {
    const api = new FakeFlowApi();
    api.signalTiers = { integrity: true, recognition: false, 'next-sequence': 6 };
    renderFlow(api);

    await giveConsent();
    await screen.findByRole('heading', { level: 1, name: 'Photograph your ID' });

    expect(collection.started).toHaveLength(1);
    expect(collection.started[0]?.firstSequence).toBe(6);
    expect(collection.started[0]?.tiers).toEqual({ integrity: true, recognition: false });
  });

  describe('the open screen when the page goes (K7A-11, owner decision 2 after 7A)', () => {
    it('flushes on pagehide, and not before consent or after the flow is gone', async () => {
      const api = new FakeFlowApi();
      api.signalTiers = { integrity: true, recognition: false };
      const { unmount } = renderFlow(api);
      await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE });
      window.dispatchEvent(new Event('pagehide'));
      expect(collection.flushed).toBe(0);

      await giveConsent();
      await screen.findByRole('heading', { level: 1, name: 'Photograph your ID' });
      window.dispatchEvent(new Event('pagehide'));
      expect(collection.flushed).toBe(1);

      unmount();
      window.dispatchEvent(new Event('pagehide'));
      expect(collection.flushed).toBe(1);
    });
  });

  it('starts with null tiers when the session may not collect', async () => {
    const api = new FakeFlowApi();
    renderFlow(api);

    await giveConsent();
    await screen.findByRole('heading', { level: 1, name: 'Photograph your ID' });

    expect(collection.started.map((options) => options.tiers)).toEqual([null]);
  });

  it('stops the collection when the flow unmounts', async () => {
    const api = new FakeFlowApi();
    api.signalTiers = { integrity: true, recognition: false };
    const { unmount } = renderFlow(api);
    await giveConsent();
    await screen.findByRole('heading', { level: 1, name: 'Photograph your ID' });

    unmount();

    expect(collection.stopped).toBe(1);
  });
});

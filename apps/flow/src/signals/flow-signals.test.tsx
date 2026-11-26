/**
 * C94.2, C94.3, C94.6 (P14): the flow with the real collector behind `FlowRenderer`'s hook. Nothing
 * is read or listened to on the consent screen; after consent, under the reported tiers, each
 * screen the person leaves is posted through the client as one valid body, and the consent screen
 * is never one of them. A session that may not collect sends nothing at all.
 */
import { flowSignalsSchema } from '@openverify/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FlowRenderer } from '../flow/flow-renderer';
import { fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';

const CONSENT_TITLE = 'Consent to use your biometric data';
const ID_TITLE = 'Photograph your ID';

/** The collector's document listeners: the capture-phase, passive ones of its event types. */
const COLLECTOR_EVENTS = new Set([
  'keydown',
  'input',
  'pointerdown',
  'pointermove',
  'click',
  'visibilitychange',
]);

function collectorListeners(spy: MockInstance<Document['addEventListener']>): string[] {
  return spy.mock.calls
    .filter(([type, , options]) => {
      const capture = typeof options === 'object' && options.capture === true;
      const passive = typeof options === 'object' && options.passive === true;
      return COLLECTOR_EVENTS.has(type) && capture && passive;
    })
    .map(([type]) => type);
}

/** Records every read of `navigator.webdriver`, the first artefact the collector reads. */
function webdriverReads() {
  const reads = vi.fn(() => false);
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: reads });
  return reads;
}

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

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'webdriver');
});

describe('the flow’s signal collection with the real collector (C94.3, C94.6, P14)', () => {
  it('reads and listens to nothing on the consent screen', async () => {
    const listeners = vi.spyOn(document, 'addEventListener');
    const reads = webdriverReads();
    const api = new FakeFlowApi();
    api.signalTiers = { integrity: true, recognition: false };

    renderFlow(api);
    await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE });
    await userEvent.click(screen.getByRole('checkbox', { name: /^I agree/ }));

    expect(collectorListeners(listeners)).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(api.signalBodies).toEqual([]);
  });

  it('after consent, posts each screen the person leaves as one valid body, never the consent screen', async () => {
    const listeners = vi.spyOn(document, 'addEventListener');
    const api = new FakeFlowApi();
    api.signalTiers = { integrity: true, recognition: false };
    const { unmount } = renderFlow(api);

    await giveConsent();
    await screen.findByRole('heading', { level: 1, name: ID_TITLE });
    expect(collectorListeners(listeners).sort()).toEqual([...COLLECTOR_EVENTS].sort());
    expect(api.signalBodies).toEqual([]);

    unmount();
    await vi.waitFor(() => {
      expect(api.signalBodies).toHaveLength(1);
    });

    const [body] = api.signalBodies;
    expect(flowSignalsSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({ platform: 'web', screen: 'government_id', sequence: 0 });
    expect(body?.integrity).toBeDefined();
    expect(body?.behaviour).toBeDefined();
    expect(body?.recognition).toBeUndefined();
    expect(api.client.sendSignals).toHaveBeenCalledTimes(1);
  });

  it('sends nothing, and listens to nothing, when the session may not collect', async () => {
    const listeners = vi.spyOn(document, 'addEventListener');
    const reads = webdriverReads();
    const api = new FakeFlowApi();
    const { unmount } = renderFlow(api);

    await giveConsent();
    await screen.findByRole('heading', { level: 1, name: ID_TITLE });
    unmount();
    await Promise.resolve();

    expect(collectorListeners(listeners)).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(api.client.sendSignals).not.toHaveBeenCalled();
  });
});

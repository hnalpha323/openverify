/**
 * C90.5, C94.3: a submission that can end the person's part first sends the open screen's body,
 * so the last screen of a flow reaches the server before the inquiry completes; a collector that
 * does not answer holds a submission at most SIGNAL_FLUSH_BOUND_MS, and a failed flush never stops it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { SIGNAL_FLUSH_BOUND_MS, flushBeforeSubmission } from './flush-before-submission';

afterEach(() => {
  vi.useRealTimers();
});

describe('flushBeforeSubmission (C90.5, C94.3)', () => {
  it('sends the open screen before a verification submit and before an OTP confirmation', async () => {
    const api = new FakeFlowApi();
    const order: string[] = [];
    const flush = vi.fn(() => {
      order.push('flush');
      return Promise.resolve();
    });
    const submit = api.client.submitVerification;
    const confirm = api.client.confirmOtp;
    submit.mockImplementation(() => {
      order.push('submit');
      return Promise.reject(new Error('stop here'));
    });
    confirm.mockImplementation(() => {
      order.push('confirm');
      return Promise.reject(new Error('stop here'));
    });
    const client = flushBeforeSubmission(api.client, flush);

    await expect(client.submitVerification('ver_1')).rejects.toThrow('stop here');
    await expect(client.confirmOtp('ver_1', { code: '123456' })).rejects.toThrow('stop here');

    expect(order).toEqual(['flush', 'submit', 'flush', 'confirm']);
    expect(submit).toHaveBeenCalledWith('ver_1');
  });

  // C150.9 (Workflow 9A): a branch after a screen may read client-collected signals, so the open
  // screen's body reaches the server before the submission that moves the position and takes the
  // branch's snapshot.
  it('sends the open screen before a screen submission', async () => {
    const api = new FakeFlowApi();
    const order: string[] = [];
    const flush = vi.fn(() => {
      order.push('flush');
      return Promise.resolve();
    });
    const submitScreen = vi.fn(() => {
      order.push('submit-screen');
      return Promise.reject(new Error('stop here'));
    });
    const client = flushBeforeSubmission({ ...api.client, submitScreen }, flush);

    await expect(client.submitScreen('about_you', { values: {} })).rejects.toThrow('stop here');

    expect(order).toEqual(['flush', 'submit-screen']);
    expect(submitScreen).toHaveBeenCalledWith('about_you', { values: {} });
  });

  it('leaves every other call alone', async () => {
    const api = new FakeFlowApi();
    const flush = vi.fn(() => Promise.resolve());
    const client = flushBeforeSubmission(api.client, flush);

    await client.getSession();

    expect(flush).not.toHaveBeenCalled();
  });

  it('waits at most the bound for a collector that does not answer, and goes on after a failed flush', async () => {
    vi.useFakeTimers();
    const api = new FakeFlowApi();
    api.client.submitVerification.mockImplementation(() => Promise.reject(new Error('submitted')));
    const stuck = flushBeforeSubmission(api.client, () => new Promise<void>(() => undefined));

    const pending = stuck.submitVerification('ver_1');
    const settled = expect(pending).rejects.toThrow('submitted');
    await vi.advanceTimersByTimeAsync(SIGNAL_FLUSH_BOUND_MS - 1);
    expect(api.client.submitVerification).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settled;

    const failing = flushBeforeSubmission(api.client, () => Promise.reject(new Error('offline')));
    await expect(failing.submitVerification('ver_1')).rejects.toThrow('submitted');
    // No collection (before consent, or none started): nothing to wait for.
    const none = flushBeforeSubmission(api.client, () => undefined);
    await expect(none.submitVerification('ver_1')).rejects.toThrow('submitted');
  });
});

/**
 * C121.3 (V04, V21): the request-scoped event cause. A run, a test run or a bulk job sets it around
 * its work, the auth plugin sets it for a request, and nothing else does.
 */
import { describe, expect, it } from 'vitest';
import { currentEventCause, enterRequestEventCause, runWithEventCause } from './cause-context.js';

describe('the event cause context', () => {
  it('is empty outside any cause: a system job or the flow', () => {
    expect(currentEventCause()).toBeUndefined();
  });

  it('holds through an await', async () => {
    const seen = await runWithEventCause({ runId: 'wfr_1' }, async () => {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      return currentEventCause();
    });

    expect(seen).toEqual({ runId: 'wfr_1' });
    expect(currentEventCause()).toBeUndefined();
  });

  it('takes the inner cause, and gives the outer one back', () => {
    const seen = runWithEventCause({ runId: 'wfr_1' }, () => [
      runWithEventCause({ testRunId: 'wfr_2' }, () => currentEventCause()),
      currentEventCause(),
    ]);

    expect(seen).toEqual([{ testRunId: 'wfr_2' }, { runId: 'wfr_1' }]);
  });

  it('fills in the request’s store once its principal is known', () => {
    const store = {};
    const seen = runWithEventCause(store, () => {
      enterRequestEventCause({ principal: 'usr_1', principalHeldInquiriesWrite: true });
      return currentEventCause();
    });

    expect(seen).toEqual({ principal: 'usr_1', principalHeldInquiriesWrite: true });
    expect(store).toEqual(seen);
  });

  it('ignores a principal with no store to hold it', () => {
    enterRequestEventCause({ principal: 'usr_1' });

    expect(currentEventCause()).toBeUndefined();
  });
});

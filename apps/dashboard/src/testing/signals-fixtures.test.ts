import { describe, expect, it } from 'vitest';
import { inquiry } from './lifecycle-fixtures';
import {
  computedSignals,
  device,
  ipRangeMatch,
  maskedDevice,
  maskedMatch,
  maskedNetwork,
  maskedSession,
  network,
  networkSources,
  phase7Session,
  phoneSession,
  sessionDocument,
} from './signals-fixtures';

describe('the synthetic Phase 7 fixtures', () => {
  it('build documents the contracts accept, masked copies included', () => {
    expect(inquiry(computedSignals()).attributes.signals).toHaveLength(7);
    expect(
      sessionDocument(maskedSession(phase7Session()), [
        maskedDevice(device()),
        maskedNetwork(network()),
      ]).included,
    ).toHaveLength(2);
    expect(phoneSession().attributes['handoff-from-session-id']).toBe(phase7Session().id);
    expect(maskedMatch(ipRangeMatch()).attributes['matched-value']).toBeNull();
    expect(networkSources().sources).toHaveLength(3);
  });
});

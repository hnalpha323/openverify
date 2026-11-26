import { describe, expect, it } from 'vitest';
import { readHandoffFragment } from './handoff';

/** C96.3, C96.5 (Stage 1a signatures): what the phone reads from its link, before any request. */
describe('readHandoffFragment', () => {
  it('reads the inquiry and the handoff token of a handoff link, and nothing else', () => {
    const token = `ovh_${'A'.repeat(43)}`;
    expect(
      readHandoffFragment(`#inquiry-id=inq_01J00000000000000000000000&handoff-token=${token}`),
    ).toEqual({
      inquiryId: 'inq_01J00000000000000000000000',
      handoffToken: token,
    });
    expect(
      readHandoffFragment('#inquiry-id=inq_01J00000000000000000000000&session-token=x'),
    ).toBeNull();
    expect(readHandoffFragment('')).toBeNull();
  });
});

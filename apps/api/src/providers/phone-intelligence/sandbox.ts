/**
 * C82.4: the sandbox `phoneIntelligence` provider (sandbox environments only, ADR 0002 §3d). It
 * calls nothing and answers NANP fictional numbers, `+1 NPA 555 01xx` (NANPA reserves 555-0100 to
 * 555-0199 for fiction), by their last two digits:
 *
 * | Ending | Answer |
 * |---|---|
 * | `00` | mobile, nothing recent |
 * | `01` | non-fixed VoIP |
 * | `02` | prepaid |
 * | `03` | mobile, SIM swapped 6 h ago |
 * | `04` | mobile, ported 10 days ago |
 * | `05` | unreachable, line type unknown |
 * | `06` | fixed VoIP |
 * | anything else, or another number | nothing checked: the numbering plan alone answers |
 *
 * For the seven endings SIM swap and porting are checked (the sandbox looks back far enough to
 * say "none"); the carrier is `Sandbox Carrier`.
 */
import type { NetworkLineType, PhoneIntelligenceLookup } from '@openverify/checks';
import { systemClock, type Clock, type PhoneIntelligenceProvider } from '../../ports.js';
import { answerOf } from './answer.js';

/** C82.4: the sandbox's carrier name. */
export const SANDBOX_PHONE_CARRIER = 'Sandbox Carrier';

/** C82.4: how long ago the sandbox's SIM swap (`03`) and port (`04`) were. */
export const SANDBOX_PHONE_EVENTS = Object.freeze({ simSwapHoursAgo: 6, portedDaysAgo: 10 });

/** The NANP fictional range: `+1`, an area code, `555 01`, and two digits. */
const FICTIONAL = /^\+1[2-9]\d{2}55501(\d{2})$/u;

const ENDINGS: Readonly<Record<string, NetworkLineType>> = {
  '00': 'mobile',
  '01': 'nonFixedVoip',
  '02': 'prepaid',
  '03': 'mobile',
  '04': 'mobile',
  '05': 'unknown',
  '06': 'fixedVoip',
};

const HOUR_MS = 3_600_000;

/** The sandbox provider (C82.4): it calls nothing. */
export function createSandboxPhoneIntelligenceProvider(
  clock: Clock = systemClock,
): PhoneIntelligenceProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    lookup({ phoneNumber }) {
      const ending = FICTIONAL.exec(phoneNumber)?.[1];
      const lineType = ending === undefined ? undefined : ENDINGS[ending];
      if (ending === undefined || lineType === undefined) {
        return Promise.resolve(
          answerOf({
            lineType: null,
            carrier: null,
            simSwap: { checked: false },
            porting: { checked: false },
          }),
        );
      }
      const now = clock.now().getTime();
      const lookup: PhoneIntelligenceLookup = {
        lineType,
        carrier: SANDBOX_PHONE_CARRIER,
        simSwap: {
          checked: true,
          lastSwapAt:
            ending === '03' ? new Date(now - SANDBOX_PHONE_EVENTS.simSwapHoursAgo * HOUR_MS) : null,
        },
        porting: {
          checked: true,
          lastPortedAt:
            ending === '04'
              ? new Date(now - SANDBOX_PHONE_EVENTS.portedDaysAgo * 24 * HOUR_MS)
              : null,
        },
      };
      return Promise.resolve(answerOf(lookup, ending !== '05'));
    },
  };
}

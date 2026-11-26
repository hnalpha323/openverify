/**
 * C211.4 (Workflow 10B, `api-integrity`): the `sandbox` provider's verdicts, one per magic token
 * (`SANDBOX_INTEGRITY_TOKENS`), deterministic and decoded at the clock's time. Production refuses the
 * binding (`providers/index.ts`). Any other token is refused (`sandbox_token_unknown`), so the job
 * stores a failed decode. Each verdict exercises one path of the two signals:
 *
 * | token | device labels | app recognition | what the signals read |
 * |---|---|---|---|
 * | `sandbox-strong` | strong, device, basic | recognised | `strong`, `true` |
 * | `sandbox-device` | device, basic | recognised | `device`, `true` |
 * | `sandbox-basic` | basic | recognised | `basic`, `true` |
 * | `sandbox-none` | none | `UNEVALUATED` | `none`, `null` (`integrity_unevaluated`) |
 * | `sandbox-unrecognized-app` | device, basic | unrecognised, another certificate | `device`, `false` |
 * | `sandbox-replayed` | device, basic | recognised, another request hash | both `null` (`integrity_decode_failed`) |
 */
import type { IntegrityVerdictProjection } from '@openverify/checks';
import type { SandboxIntegrityToken } from '@openverify/contracts';
import { DeviceIntegrityDecodeError } from './errors.js';

type Verdict = Omit<IntegrityVerdictProjection, 'decoded-at' | 'outcome'>;

const PASSED: Verdict['checks'] = {
  'package-name': true,
  'request-hash': true,
  timestamp: true,
  'app-recognized': true,
  'certificate-digest': true,
};

const DEVICE: Verdict['device-recognition'] = ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'];

const SANDBOX_VERDICTS: Readonly<Record<SandboxIntegrityToken, Verdict>> = {
  'sandbox-strong': {
    'device-recognition': ['MEETS_STRONG_INTEGRITY', ...DEVICE],
    'app-recognition': 'PLAY_RECOGNIZED',
    checks: PASSED,
  },
  'sandbox-device': {
    'device-recognition': DEVICE,
    'app-recognition': 'PLAY_RECOGNIZED',
    checks: PASSED,
  },
  'sandbox-basic': {
    'device-recognition': ['MEETS_BASIC_INTEGRITY'],
    'app-recognition': 'PLAY_RECOGNIZED',
    checks: PASSED,
  },
  'sandbox-none': {
    'device-recognition': [],
    'app-recognition': 'UNEVALUATED',
    checks: { ...PASSED, 'app-recognized': false },
  },
  'sandbox-unrecognized-app': {
    'device-recognition': DEVICE,
    'app-recognition': 'UNRECOGNIZED_VERSION',
    checks: { ...PASSED, 'app-recognized': false, 'certificate-digest': false },
  },
  'sandbox-replayed': {
    'device-recognition': DEVICE,
    'app-recognition': 'PLAY_RECOGNIZED',
    checks: { ...PASSED, 'request-hash': false },
  },
};

const isSandboxToken = (token: string): token is SandboxIntegrityToken =>
  Object.hasOwn(SANDBOX_VERDICTS, token);

/** C211.4: the sandbox's verdict for a magic token. */
export function sandboxVerdict(token: string, now: Date): IntegrityVerdictProjection {
  if (!isSandboxToken(token)) {
    throw new DeviceIntegrityDecodeError('sandbox_token_unknown', false);
  }
  const verdict = SANDBOX_VERDICTS[token];
  return {
    outcome: 'decoded',
    'device-recognition': [...verdict['device-recognition']],
    'app-recognition': verdict['app-recognition'],
    checks: { ...verdict.checks },
    'decoded-at': now.toISOString(),
  };
}

/** C127.9: `trust_device`, on the mark `trustDeviceInTx` writes in the effect's transaction. */
import { trustDeviceConfigSchema } from '@openverify/workflow-engine/actions';
import { getDevice } from '@openverify/db';
import type { TransactionActionHandler } from '../../engine/action-port.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';
import { trustDeviceInTx } from './trust.js';

export const TRUST_DEVICE_HANDLER: TransactionActionHandler = {
  key: 'trust_device',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, trustDeviceConfigSchema);
    const id = config['device-id'];
    const before = await getDevice(tx, context.environmentId, id);
    const trusted = config.untrust !== true;
    const unchanged =
      before !== null &&
      (trusted ? before.trustReason === config['trust-reason'] : before.trustedAt === null);
    const device = unchanged
      ? before
      : await refusing(() => trustDeviceInTx(tx, apiDepsOf(context), context.acting, id, config));
    return {
      kind: 'succeeded',
      output: {
        'device-id': device.id,
        'trusted-at': device.trustedAt?.toISOString() ?? null,
        outcome: unchanged ? 'no_change' : 'applied',
      },
      subjects: [{ subjectId: id, source: 'written' }],
    };
  },
};

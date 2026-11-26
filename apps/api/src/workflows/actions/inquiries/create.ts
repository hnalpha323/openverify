/** C122.2: `create_inquiry`, through `createInquiryInTx` in the effect's transaction. */
import { createInquiryConfigSchema } from '@openverify/workflow-engine/actions';
import type { CreateInquiryAttributes } from '@openverify/contracts';
import { createInquiryInTx } from '../../../services/inquiries.js';
import type { TransactionActionHandler } from '../../engine/action-port.js';
import { recordCreatedObjectInTx } from '../children.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

export const CREATE_INQUIRY_HANDLER: TransactionActionHandler = {
  key: 'create_inquiry',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, createInquiryConfigSchema);
    const { inquiry, staged } = await refusing(() =>
      createInquiryInTx(
        tx,
        apiDepsOf(context),
        context.acting,
        config as unknown as CreateInquiryAttributes,
      ),
    );
    await recordCreatedObjectInTx(tx, context, 'inquiries', {
      id: inquiry.id,
      childType: 'inquiry',
    });
    return {
      kind: 'succeeded',
      output: {
        'inquiry-id': inquiry.id,
        status: inquiry.status,
        'account-id': inquiry.accountId,
      },
      staged,
      subjects: [{ subjectId: inquiry.id, source: 'written' }],
    };
  },
};

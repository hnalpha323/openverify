/**
 * C126.2: Send SMS, through the bound `SmsSender`, to one number, rendered last. The messenger holds
 * the rules; this says what the recipient is and which countries the run's inquiry template accepts.
 */
import { sendSmsConfigSchema } from '@openverify/workflow-engine/actions';
import type {
  ActionContext,
  ActionResult,
  OutsideActionHandler,
} from '../../engine/action-port.js';
import { recipientBasisOf, templateCountriesOf } from '../messaging/confirmed.js';
import { deliverMessage, isLiteral, renderMember } from '../messaging/render.js';
import { answering, configOf } from '../shared.js';

async function execute(context: ActionContext): Promise<ActionResult> {
  const config = configOf(context, sendSmsConfigSchema);
  const to = renderMember(context, config.recipient, 'text');
  return deliverMessage(
    context,
    {
      kind: 'sms',
      to,
      basis: await recipientBasisOf(context, 'sms', to, isLiteral(config.recipient)),
      allowUnconfirmed: config['allow-unconfirmed'] === true,
      text: renderMember(context, config.text, 'text'),
      templateCountries: await templateCountriesOf(context),
    },
    null,
  );
}

export const SEND_SMS_HANDLER: OutsideActionHandler = {
  key: 'send_sms',
  version: 1,
  shape: 'outside',
  execute: (context) => answering(() => execute(context)),
};

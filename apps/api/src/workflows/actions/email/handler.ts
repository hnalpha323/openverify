/**
 * C126.1: Send Email, through the install's `Mailer` and From address, to one recipient, rendered last.
 * The messenger holds the rules; this says what the recipient is and what each member's sink is.
 */
import { MESSAGE_LIMITS, sendEmailConfigSchema } from '@openverify/workflow-engine/actions';
import type {
  ActionContext,
  ActionResult,
  OutsideActionHandler,
} from '../../engine/action-port.js';
import { recipientBasisOf } from '../messaging/confirmed.js';
import { deliverMessage, isLiteral, renderMember } from '../messaging/render.js';
import { answering, configOf } from '../shared.js';

async function execute(context: ActionContext): Promise<ActionResult> {
  const config = configOf(context, sendEmailConfigSchema);
  const to = renderMember(context, config.recipient, 'text');
  const basis = await recipientBasisOf(context, 'email', to, isLiteral(config.recipient));
  return deliverMessage(
    context,
    {
      kind: 'email',
      to,
      basis,
      allowUnconfirmed: config['allow-unconfirmed'] === true,
      subject: renderMember(context, config.subject, 'text'),
      text: renderMember(context, config.text, 'text'),
      html:
        config.html === undefined
          ? null
          : renderMember(
              context,
              config.html,
              'email-html',
              MESSAGE_LIMITS['email-html-bytes'].value,
            ),
    },
    context.services.flowPublicUrl,
  );
}

export const SEND_EMAIL_HANDLER: OutsideActionHandler = {
  key: 'send_email',
  version: 1,
  shape: 'outside',
  execute: (context) => answering(() => execute(context)),
};

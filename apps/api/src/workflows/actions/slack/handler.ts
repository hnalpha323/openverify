/**
 * C126.3: Send Slack Message: the text rendered with `&`, `<` and `>` escaped in every interpolated
 * value, so `<!channel>` typed by an end user pings nobody, and the webhook named by its key alone:
 * the messenger resolves the URL, last.
 */
import { secretKeysOf } from '@openverify/contracts';
import { sendSlackMessageConfigSchema } from '@openverify/workflow-engine/actions';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type OutsideActionHandler,
} from '../../engine/action-port.js';
import { deliverMessage, renderMember } from '../messaging/render.js';
import { answering, configOf } from '../shared.js';

function execute(context: ActionContext): Promise<ActionResult> {
  const config = configOf(context, sendSlackMessageConfigSchema);
  const [secretKey] = secretKeysOf(config['webhook-secret']);
  if (secretKey === undefined) {
    throw new ActionStepError('secret_placement_refused');
  }
  return deliverMessage(
    context,
    { kind: 'slack', secretKey, text: renderMember(context, config.text, 'slack-text') },
    null,
  );
}

export const SEND_SLACK_MESSAGE_HANDLER: OutsideActionHandler = {
  key: 'send_slack_message',
  version: 1,
  shape: 'outside',
  execute: (context) => answering(() => execute(context)),
};

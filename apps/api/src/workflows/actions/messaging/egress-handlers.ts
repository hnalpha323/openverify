/** C122.1: `api-egress`' handlers, by `key@version`, joined to the process's table beside the others. */
import type { ActionHandler } from '../../engine/action-port.js';
import { EVALUATE_CODE_HANDLER } from '../code/handler.js';
import { SEND_EMAIL_HANDLER } from '../email/handler.js';
import { MAKE_HTTPS_REQUEST_HANDLER } from '../https/handler.js';
import { SEND_SLACK_MESSAGE_HANDLER } from '../slack/handler.js';
import { SEND_SMS_HANDLER } from '../sms/handler.js';

export const EGRESS_ACTION_HANDLERS: readonly ActionHandler[] = [
  MAKE_HTTPS_REQUEST_HANDLER,
  SEND_EMAIL_HANDLER,
  SEND_SMS_HANDLER,
  SEND_SLACK_MESSAGE_HANDLER,
  EVALUATE_CODE_HANDLER,
];

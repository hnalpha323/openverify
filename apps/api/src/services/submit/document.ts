/**
 * C52.6, C54.1: the `document` submit (`api-document`): the standard guard. A submit takes no
 * body member (a selfie capture, a crypto signature or chip data is refused, 422) and needs the
 * step's `document` file stored (422 naming it otherwise); the upload route has already typed the
 * file by its content (an image or a PDF, C52.4) and refused the server-written `document-preview`.
 * The step's capture methods are not enforced here: they tell the client what to offer (the flow
 * view's `accepted-mime-types`), and the job reads a PDF or a photo alike. A repeated submit only
 * enqueues again (C3).
 */
import { standardSubmitGuard } from './standard.js';

export const documentSubmit = standardSubmitGuard();

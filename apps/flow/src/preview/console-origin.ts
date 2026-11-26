/**
 * C156.2 (Workflow 9A, `flow-server-embed`): the console origin the preview answers and accepts
 * messages from. The flow server writes it into the preview document as a `<meta>`, from the same
 * `OPENVERIFY_DASHBOARD_PUBLIC_URL` it sends as `frame-ancestors`, so the header and the message
 * check name one origin. Without it the preview accepts nothing and posts nothing.
 */

/** The `<meta name>` the flow server writes the console origin into (`server.ts`'s constant). */
export const PREVIEW_CONSOLE_ORIGIN_META = 'openverify-console-origin';

/** The console origin of `document`, or `null` unless it is an exact http(s) origin. */
export function consoleOriginOf(document: Pick<Document, 'querySelector'>): string | null {
  const content = document
    .querySelector(`meta[name="${PREVIEW_CONSOLE_ORIGIN_META}"]`)
    ?.getAttribute('content');
  if (content === undefined || content === null) {
    return null;
  }
  try {
    const url = new URL(content);
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    return web && url.origin === content ? content : null;
  } catch {
    return null;
  }
}

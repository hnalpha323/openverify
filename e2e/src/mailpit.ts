/**
 * Reads email the stack sent through its Mailpit (development SMTP sink), using Mailpit's
 * HTTP API: `GET /api/v1/search?query=to:"<address>"` (newest first), then
 * `GET /api/v1/message/<id>`.
 */
export interface Mail {
  /** Mailpit's message id. */
  id: string;
  subject: string;
  text: string;
  html: string;
}

export interface WaitForMailOptions {
  timeoutMs: number;
  /** Between searches; defaults to 250 ms. */
  intervalMs?: number;
  /** Defaults to the global `fetch`. */
  fetch?: (url: string) => Promise<Response>;
  /** Messages read already (their `id`s): the newest other message is awaited. */
  exceptIds?: readonly string[];
}

/**
 * The newest email to `address`, waiting until one arrives.
 * @throws {Error} after `timeoutMs`, or when Mailpit answers an error.
 */
export async function waitForMail(
  mailpitUrl: string,
  address: string,
  options: WaitForMailOptions,
): Promise<Mail> {
  const get = options.fetch ?? ((url: string) => fetch(url));
  const read = async <T>(path: string): Promise<T> => {
    const response = await get(`${mailpitUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Mailpit answered ${String(response.status)} for ${path}`);
    }
    return (await response.json()) as T;
  };
  const deadline = Date.now() + options.timeoutMs;
  const query = new URLSearchParams({ query: `to:"${address}"` });
  for (;;) {
    const found = await read<{ messages?: { ID: string }[] }>(`/api/v1/search?${query.toString()}`);
    const skipped = new Set(options.exceptIds ?? []);
    const newest = (found.messages ?? []).find((message) => !skipped.has(message.ID));
    if (newest !== undefined) {
      const message = await read<{ Subject: string; Text: string; HTML: string }>(
        `/api/v1/message/${encodeURIComponent(newest.ID)}`,
      );
      return { id: newest.ID, subject: message.Subject, text: message.Text, html: message.HTML };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No email to ${address} arrived in Mailpit within ${String(options.timeoutMs)} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 250));
  }
}

/**
 * A synthetic HTTP answer for a local stub or an undici `MockAgent` interceptor (rule: tests never
 * touch the network): `mockAgent.get(origin).intercept({ path }).reply(answer.status, answer.body,
 * { headers: answer.headers })`.
 */

export interface StubAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A JSON answer (`application/json; charset=utf-8` unless `headers` says otherwise). */
export function jsonAnswer(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): StubAnswer {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  };
}

/** A plain-text answer (`text/plain; charset=utf-8` unless `headers` says otherwise). */
export function textAnswer(
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): StubAnswer {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body };
}

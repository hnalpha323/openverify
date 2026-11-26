/**
 * C207.9, C207.10 (Phase 10, Workflow 10C; `api-nfc`): the mocked flow API's answers for the web
 * flow's `nfc` step, registered once at import (`registerMockFlowExtension`), so the shared mock is
 * never edited. The shared mock knows no chip verification, so this extension keeps the step's
 * own: `POST /verifications` with `government-id-nfc` answers the open attempt or makes one. And it
 * answers `POST /verifications/:id/client-unable` as the server does:
 *
 * - 200 `{ verification-id, status: 'canceled' }` for an `initiated` chip verification, which it
 *   ends `canceled`, serving the position the spec scripted for the fallback (`fallbackTo`);
 * - 409 `client_unable_not_allowed` (the golden problem) for a verification already reported, for
 *   any other verification, and while the script refuses (`refuse`).
 *
 * It records every report for assertions. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { registerMockFlowExtension, type MockFlowApi } from './mock-flow-api';
import { serve, type ServedPosition } from './mock-flow-renderer';

export interface ClientUnableReport {
  readonly verificationId: string;
  readonly body: unknown;
}

/** A chip verification the flow created through the mock. */
export interface NfcVerification {
  readonly id: string;
  status: 'initiated' | 'canceled';
}

export class NfcScript {
  /** The chip verifications the flow created, oldest first. */
  readonly verifications: NfcVerification[] = [];
  /** Every client-unable report the flow sent, in order. */
  readonly reports: ClientUnableReport[] = [];
  /** What the session serves once a report was taken; `null` leaves it as it is. */
  fallbackTo: ServedPosition | null = null;
  /** How many of the next reports answer 409 `client_unable_not_allowed`. */
  refuse = 0;
}

const SCRIPTS = new WeakMap<MockFlowApi, NfcScript>();

/** The nfc script of `mock`, made on first use. */
export function nfcScript(mock: MockFlowApi): NfcScript {
  let script = SCRIPTS.get(mock);
  if (script === undefined) {
    script = new NfcScript();
    SCRIPTS.set(mock, script);
  }
  return script;
}

/** An `nfc` step's client view, as a spec-2 session serves it. */
export function nfcView(fallbackAvailable: boolean): Readonly<Record<string, unknown>> {
  return { id: 'chip', type: 'nfc', androidOnly: true, maxAttempts: 3, fallbackAvailable };
}

const CLIENT_UNABLE = /^\/verifications\/(ver_[0-9A-Z]{26})\/client-unable$/u;

/** The golden problem of a refused report (`contracts/fixtures/problems/flow/`). */
const NOT_ALLOWED = JSON.parse(
  readFileSync(
    new URL(
      '../../../../contracts/fixtures/problems/flow/client-unable-not-allowed.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { title: string; status: number; detail: string; code: string };

const AT = '2026-10-20T12:00:00.000Z';

const resourceOf = (verification: NfcVerification) => ({
  type: 'verification/government-id-nfc',
  id: verification.id,
  attributes: {
    status: verification.status,
    'retry-hints': [],
    'created-at': AT,
    'updated-at': AT,
  },
});

registerMockFlowExtension('nfc', {
  route: async ({ mock, request, method, path, reply, problem }) => {
    if (method !== 'POST') {
      return false;
    }
    const script = nfcScript(mock);
    if (path === '/verifications') {
      if ((request.postDataJSON() as { type?: unknown }).type !== 'government-id-nfc') {
        return false;
      }
      let open = script.verifications.find((one) => one.status === 'initiated');
      if (open === undefined) {
        const index = String(script.verifications.length).padStart(2, '0');
        open = { id: `ver_01M5CK16P0D13FXHZSS4TCNF${index}`, status: 'initiated' };
        script.verifications.push(open);
      }
      await reply(201, { data: resourceOf(open) });
      return true;
    }
    const match = CLIENT_UNABLE.exec(path);
    if (match === null) {
      return false;
    }
    const verification = script.verifications.find((one) => one.id === match[1]);
    if (verification === undefined) {
      // The golden's 409 for a verification that is not a chip attempt of this step.
      const known = mock.verifications.some((one) => one.id === match[1]);
      await (known
        ? problem(NOT_ALLOWED.status, NOT_ALLOWED.title, {
            detail: NOT_ALLOWED.detail,
            code: NOT_ALLOWED.code,
          })
        : problem(404, 'Not Found'));
      return true;
    }
    script.reports.push({ verificationId: verification.id, body: request.postDataJSON() });
    const refused = script.refuse > 0;
    if (refused) {
      script.refuse -= 1;
    }
    if (refused || verification.status !== 'initiated') {
      await problem(NOT_ALLOWED.status, NOT_ALLOWED.title, {
        detail: NOT_ALLOWED.detail,
        code: NOT_ALLOWED.code,
      });
      return true;
    }
    verification.status = 'canceled';
    if (script.fallbackTo !== null) {
      serve(mock, script.fallbackTo);
    }
    await reply(200, { 'verification-id': verification.id, status: 'canceled' });
    return true;
  },
});

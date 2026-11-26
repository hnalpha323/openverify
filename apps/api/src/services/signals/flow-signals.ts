/**
 * C94.2, C94.6 (Workflow 7A): `POST /api/v1/flow/signals` (session authentication, 202, a body
 * cap of 8 KiB, the C12 policy `flow-signals`). Owner: `api-signals`; the signature is frozen by
 * `foundation-7a` (Stage 1b (S)) with the route (`routes/flow/signals.ts`).
 *
 * It refuses the body with 409 `consent_required` until the session may collect, drops
 * `recognition` without its tier, refuses `sandbox-outcome` in production (422
 * `sandbox_only_value`), stores the body sealed (`storeSessionSignalBody`), ignores a repeated
 * `(session, sequence)` and counts the 201st body and later ones, all with 202.
 */
import { parseSignalRequestHeaders } from '@openverify/checks';
import type { FlowSessionSignals, FlowSignals } from '@openverify/contracts';
import {
  deviceHmacs,
  deviceIdentifierInputs,
  getEnvironment,
  getInquiry,
  getEffectiveConsent,
  getInquiryTemplateVersion,
  linkSessionDevice,
  recordSdkSessionDeviceType,
  recordSessionSignalsCollected,
  storeSessionSignalBody,
} from '@openverify/db';
import type { FlowSession } from '../../auth/flow-session.js';
import { SignalProblemError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { storedFlowView } from '../stored-flow.js';
import { collectedTiersOf, collectionTiersOf } from './flow-session.js';

/** What the route hands the service besides the body: the request's bounded header facts (V13). */
export interface FlowSignalsRequest {
  /** The primary `Accept-Language` tags, at most 5, each a BCP 47 tag. */
  acceptLanguages: readonly string[];
  /** The low-entropy `Sec-CH-UA`, `Sec-CH-UA-Mobile` and `Sec-CH-UA-Platform` values, capped. */
  clientHints: Readonly<Record<string, string>>;
}

/** The members a body keeps under the session's tiers, before sealing. */
export interface KeptSignals {
  /** `integrity` or `android-integrity` and the request facts (integrity), `recognition` or
   * `android-recognition` (recognition), `device-class` and, in a sandbox, `sandbox-outcome`. */
  components: Record<string, unknown> | null;
  /** The per-screen aggregates, only under session integrity. */
  behaviour: Record<string, unknown> | null;
}

/**
 * C94.2, C94.4, C94.6: what the session may keep of `body`. Session integrity keeps the integrity
 * member (with the request's own header facts, V13) and the behaviour; device recognition keeps the
 * recognition member; anything a tier does not allow is dropped, never stored. `device-class` (a
 * phone or a tablet, which sets an SDK session's device type as the user agent does a browser's)
 * and the sandbox outcome ride with whichever tier applies.
 */
export function keptSignals(
  body: FlowSignals,
  tiers: FlowSessionSignals,
  request: FlowSignalsRequest,
): KeptSignals {
  const components: Record<string, unknown> = {};
  if (tiers.integrity) {
    if (body.integrity !== undefined) {
      components.integrity = body.integrity;
      components.request = parseSignalRequestHeaders({
        'accept-language': request.acceptLanguages.join(', '),
        ...request.clientHints,
      });
    }
    if (body['android-integrity'] !== undefined) {
      components['android-integrity'] = body['android-integrity'];
    }
  }
  if (tiers.recognition) {
    if (body.recognition !== undefined) {
      components.recognition = body.recognition;
    }
    if (body['android-recognition'] !== undefined) {
      components['android-recognition'] = body['android-recognition'];
    }
  }
  if (body['device-class'] !== undefined) {
    components['device-class'] = body['device-class'];
  }
  if (body['sandbox-outcome'] !== undefined) {
    components['sandbox-outcome'] = body['sandbox-outcome'];
  }
  return {
    components: Object.keys(components).length === 0 ? null : components,
    behaviour: tiers.integrity && body.behaviour !== undefined ? { ...body.behaviour } : null,
  };
}

/**
 * C94.2: stores one signal body of the session, sealed, with 202 whatever happens to it: stored, a
 * repeated sequence ignored, or the 201st and later bodies counted (P23). Under device recognition
 * a body with an identifier links the session to its device (C91.2, C94.4).
 * @throws {SignalProblemError} 422 `sandbox_only_value` for a sandbox outcome outside a sandbox;
 * 409 `consent_required` until a collection tier applies to the session.
 */
export async function recordFlowSignals(
  deps: ApiDependencies,
  session: FlowSession,
  body: FlowSignals,
  request: FlowSignalsRequest,
): Promise<void> {
  const { db, clock, ids, blindIndexKey } = deps;
  const { environmentId } = session;
  const environment = await getEnvironment(db, environmentId);
  const inquiry = await getInquiry(db, environmentId, session.inquiryId);
  if (environment === null || inquiry === null) {
    throw new Error('The flow session has no environment or inquiry.');
  }
  if (body['sandbox-outcome'] !== undefined && environment.kind !== 'sandbox') {
    throw new SignalProblemError(
      'sandbox_only_value',
      'sandbox-outcome is accepted only in a sandbox environment.',
    );
  }
  const version = await getInquiryTemplateVersion(
    db,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  // C94.6 (V03): the consent this session may rely on; a handoff session's own only.
  const consent = await getEffectiveConsent(db, {
    environmentId,
    inquiryId: inquiry.id,
    sessionId: session.id,
  });
  const tiers =
    version === null
      ? null
      : collectionTiersOf(
          environment.settings,
          storedFlowView(version.flow),
          consent === null
            ? null
            : {
                acceptedAt: consent.acceptedAt,
                textKeys: consent.textKeys,
                optionalTextKeys: consent.optionalTextKeys ?? [],
              },
        );
  if (tiers === null || (!tiers.integrity && !tiers.recognition)) {
    throw new SignalProblemError(
      'consent_required',
      'The session may not send signals: no collection tier applies to it yet.',
    );
  }
  const kept = keptSignals(body, tiers, request);
  const at = clock.now();
  await db.transaction(async (tx) => {
    const outcome = await storeSessionSignalBody(tx, environmentId, {
      inquirySessionId: session.id,
      sequence: body.sequence,
      screen: body.screen,
      platform: body.platform,
      collectorVersion: body['collector-version'],
      components: kept.components,
      behaviour: kept.behaviour,
      at,
    });
    await recordSessionSignalsCollected(tx, environmentId, session.id, collectedTiersOf(tiers));
    if (outcome !== 'stored') {
      return;
    }
    if (body['device-class'] !== undefined) {
      await recordSdkSessionDeviceType(tx, environmentId, session.id, body['device-class']);
    }
    const inputs = tiers.recognition
      ? deviceIdentifierInputs(body.platform, kept.components)
      : null;
    if (inputs !== null) {
      await linkSessionDevice(tx, environmentId, {
        deviceId: ids.newId('dev'),
        inquirySessionId: session.id,
        platform: body.platform,
        collectorVersion: body['collector-version'],
        ...deviceHmacs(blindIndexKey, environmentId, inputs),
        fingerprintRandomised: inputs.fingerprintRandomised,
        at,
      });
    }
  });
}

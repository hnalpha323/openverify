/**
 * Mock routes for the page tests of the people verification types (phone number, email address,
 * crypto wallet; C66), on `routeApi` (`testing/api-routes.ts`). The verification page reads
 * `GET /verifications/:id?include=selfies` and, with `inquiries:read`, the dashboard inquiry
 * document; `servePeopleVerification` answers both for one verification. The inquiry document can
 * carry another copy of it (`seen`), so a test proves the page shows only what the verification
 * answer says. Every value is synthetic.
 */
import type { VerificationResource } from '@openverify/contracts';
import type { RouteApi } from '../api-routes';
import { LIFECYCLE_IDS, inquiryDocument } from '../lifecycle-fixtures';

export interface PeopleRoutesOptions {
  /** The verification as the inquiry document carries it; the answer itself by default. */
  readonly seen?: VerificationResource;
  /** When the inquiry was redacted. */
  readonly redactedAt?: string;
}

/** The verification page's path of `verification`, after `/api/v1`. */
export const verificationPath = (verification: VerificationResource) =>
  `/verifications/${verification.id}`;

/** Answers the verification page's two reads for `verification`, of `LIFECYCLE_IDS.inquiry`. */
export function servePeopleVerification(
  api: RouteApi,
  verification: VerificationResource,
  options: PeopleRoutesOptions = {},
): RouteApi {
  const inquiry = inquiryDocument(
    options.redactedAt === undefined ? {} : { 'redacted-at': options.redactedAt },
  );
  return api
    .on('GET', verificationPath(verification), 200, { data: verification })
    .on('GET', `/dashboard/inquiries/${LIFECYCLE_IDS.inquiry}`, 200, {
      ...inquiry,
      included: [
        ...inquiry.included.filter((resource) => resource.id !== verification.id),
        options.seen ?? verification,
      ],
    });
}

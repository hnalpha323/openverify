/**
 * C173.2 (K17): `GET /verifications/:id?include=files`, the verification with its file resources,
 * metadata only (kind, media type, size, time; never a file's bytes or name), as the API answers
 * them for this reader. The route takes one include at a time, so a selfie's captures are read
 * by a second call (`include=selfies`).
 */
import 'server-only';
import { verificationDocumentSchema, type VerificationDocument } from '@openverify/contracts';
import { apiRequest } from './client';

export function getVerificationWithFiles(id: string): Promise<VerificationDocument> {
  return apiRequest({
    method: 'GET',
    path: `/verifications/${encodeURIComponent(id)}`,
    query: { include: 'files' },
    schema: verificationDocumentSchema,
  });
}

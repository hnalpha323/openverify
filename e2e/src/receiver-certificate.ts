/**
 * C146.3: Make HTTPS Request reaches `https:` alone, so the local receiver needs a certificate its
 * worker trusts. A throwaway self-signed one for `localhost`, made at each stack start and gitignored
 * with the rest of `.artifacts`; the worker reads it through `NODE_EXTRA_CA_CERTS`, and nothing else
 * trusts it. It holds no secret of the product, and it lives two days.
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ReceiverCertificateFiles {
  certificate: string;
  key: string;
}

export async function writeReceiverCertificate(files: ReceiverCertificateFiles): Promise<void> {
  await mkdir(path.dirname(files.certificate), { recursive: true });
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-nodes',
    '-keyout',
    files.key,
    '-out',
    files.certificate,
    '-days',
    '2',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost',
  ]);
}

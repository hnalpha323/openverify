/**
 * C249.1 (G-TLS; Phase 11, Workflow 11B, platform-ops), against a real TLS server: a client that
 * names no CA of its own (as node-postgres, ioredis, the AWS SDK and undici do with this
 * configuration) refuses a server signed by a private CA until `applyStoreTls` adds that CA to the
 * process's default trust store, and still checks the host name after it. The CA and the server's
 * key are made per run by the `openssl` command in a temporary folder and never kept; the trust
 * store is restored at the end.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyStoreTls, NO_STORE_TLS } from './store-tls.js';

let directory: string;
let server: tls.Server;
let port: number;
let caPath: string;
let original: string[];

function openssl(...args: string[]): void {
  execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
}

/** Resolves when the handshake verifies, rejects with its error code otherwise. */
function handshake(servername: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, servername }, () => {
      socket.end();
      resolve();
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code ?? error.message));
    });
  });
}

beforeAll(async () => {
  original = tls.getCACertificates('default');
  directory = mkdtempSync(join(tmpdir(), 'openverify-store-tls-'));
  caPath = join(directory, 'ca.pem');
  openssl(
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '1',
    '-subj',
    '/CN=OpenVerify synthetic test CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign',
  );
  openssl(
    'req',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-nodes',
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
    '-subj',
    '/CN=localhost',
  );
  writeFileSync(join(directory, 'san.ext'), 'subjectAltName=DNS:localhost\n');
  openssl(
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'server.pem',
    '-days',
    '1',
    '-extfile',
    'san.ext',
  );
  server = tls.createServer(
    {
      key: readFileSync(join(directory, 'server.key')),
      cert: readFileSync(join(directory, 'server.pem')),
    },
    (socket) => socket.end(),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  tls.setDefaultCACertificates(original);
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});

describe('applyStoreTls with a real TLS server (C249.1)', () => {
  it('refuses the private CA before, trusts it after, and still checks the host name', async () => {
    await expect(handshake('localhost')).rejects.toThrow(/UNABLE_TO_|SELF_SIGNED/u);

    applyStoreTls({ caFiles: { ...NO_STORE_TLS.caFiles, postgres: caPath } });

    await expect(handshake('localhost')).resolves.toBeUndefined();
    await expect(handshake('other.example.org')).rejects.toThrow('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(tls.getCACertificates('default').length).toBe(original.length + 1);
  });
});

/**
 * Synthetic trust-store sources for the sync's, the command's and the refresh job's tests: a
 * root CSCA served in a zip as BSI serves it, a CMS master list from `@openverify/emrtd/testing`,
 * the root's CRL at a national distribution point, and a scripted outbound client that answers
 * from them (nothing leaves the process). Only tests import this file.
 */
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import {
  buildCrl,
  buildCsca,
  buildMasterList,
  type TestCertificate,
} from '@openverify/emrtd/testing';
import type {
  OutboundHttp,
  OutboundHttpClientOptions,
  OutboundHttpRequest,
  OutboundHttpResponse,
} from '../http/index.js';
import type { TrustAnchorManifest } from './manifest.js';

export const SYNTHETIC_ROOT_URL = 'https://lists.example.test/root.zip';
export const SYNTHETIC_LIST_URL = 'https://lists.example.test/master-list.zip';
export const SYNTHETIC_CRL_URL = 'http://crl.example.test/de.crl';

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** A zip of `entries`, each deflated unless told otherwise. */
export function zipOf(
  entries: readonly { name: string; data: Uint8Array; deflate?: boolean }[],
): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = entry.deflate === false ? Buffer.from(entry.data) : deflateRawSync(entry.data);
    const method = entry.deflate === false ? 0 : 8;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

export interface ScriptedRoute {
  status?: number;
  contentType?: string;
  body: Uint8Array;
}

/** An outbound client answering from `routes` (404 otherwise), recording each request. */
export function scriptedOutboundHttp(routes: ReadonlyMap<string, ScriptedRoute>) {
  const requests: { url: string; options: OutboundHttpClientOptions }[] = [];
  const http: OutboundHttp = {
    client: (options) => ({
      request: (request: OutboundHttpRequest): Promise<OutboundHttpResponse> => {
        requests.push({ url: request.url, options });
        const route = routes.get(request.url);
        const status = route?.status ?? (route === undefined ? 404 : 200);
        return Promise.resolve(
          status >= 200 && status < 300 && route !== undefined
            ? {
                status,
                contentType: route.contentType ?? 'application/octet-stream',
                body: route.body,
              }
            : { status, contentType: null, body: new Uint8Array() },
        );
      },
    }),
    close: () => Promise.resolve(),
  };
  return { http, requests };
}

export interface SyntheticSource {
  root: TestCertificate;
  /** A list of `certificates` signed by the root's master list signer at `signingTime`. */
  list(certificates: readonly TestCertificate[], signingTime: Date): Uint8Array;
  /** The routes serving the zipped root, the zipped list and the root's CRL. */
  routes(list: Uint8Array): Map<string, ScriptedRoute>;
  /** A manifest of this source (enabled), as `trust-anchors/manifest.json` would hold it. */
  manifest(): TrustAnchorManifest;
}

/** A German-shaped synthetic source under a root built from `seed` at `now`. */
export function syntheticSource(seed: string, now: Date): SyntheticSource {
  const root = buildCsca({
    seed,
    now,
    country: 'DE',
    commonName: `Synthetic CSCA ${seed}`,
    crlDistributionPoint: SYNTHETIC_CRL_URL,
  });
  return {
    root,
    list: (certificates, signingTime) =>
      buildMasterList({ signerSeed: `${seed}/signer`, root, certificates, signingTime }),
    routes: (list) =>
      new Map<string, ScriptedRoute>([
        [
          SYNTHETIC_ROOT_URL,
          { body: zipOf([{ name: 'root.cer', data: root.der }]), contentType: 'application/zip' },
        ],
        [
          SYNTHETIC_LIST_URL,
          { body: zipOf([{ name: 'list.ml', data: list }]), contentType: 'application/zip' },
        ],
        [SYNTHETIC_CRL_URL, { body: buildCrl({ issuer: root, now, crlNumber: 1 }) }],
      ]),
    manifest: () => ({
      schema_version: 1,
      sources: [
        {
          id: 'bsi-de',
          enabled: true,
          publisher: 'Synthetic publisher',
          list_url: SYNTHETIC_LIST_URL,
          root_certificate_url: SYNTHETIC_ROOT_URL,
          root_certificate_sha256: sha256Hex(root.der),
          fingerprint_checked_against: 'synthetic',
          content_type: '2.23.136.1.1.2',
          signer_eku: '2.23.136.1.1.3',
          terms: 'synthetic',
        },
      ],
    }),
  };
}

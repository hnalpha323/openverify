/**
 * A software WebAuthn authenticator for tests: a P-256 (ES256) key pair that answers
 * registration options with a `none` attestation and authentication options with signed
 * assertions, as a browser and a platform authenticator would together. Only tests import it.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

export interface SoftwareAuthenticatorOptions {
  /** The origin the "browser" reports; defaults to the dashboard origin of the tests. */
  origin: string;
  /** Set user verification in the flags. Defaults to true. */
  userVerified?: boolean;
  /** Every assertion reports this counter instead of counting up (cloned authenticators). */
  fixedCounter?: number;
}

export interface SoftwareAuthenticator {
  /** base64url credential id. */
  readonly credentialId: string;
  /** The signature counter the next assertion reports. */
  counter: number;
  /** `navigator.credentials.create()` for `options`. */
  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    overrides?: { origin?: string; rpId?: string },
  ): RegistrationResponseJSON;
  /** `navigator.credentials.get()` for `options`. */
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    overrides?: { origin?: string; rpId?: string; challenge?: string },
  ): AuthenticationResponseJSON;
}

function coseKey(publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x ?? '', 'base64url');
  const y = Buffer.from(jwk.y ?? '', 'base64url');
  // COSE_Key (RFC 9053): kty EC2, alg ES256, crv P-256, x, y.
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Uint8Array.from(x)],
      [-3, Uint8Array.from(y)],
    ]),
  );
}

export function createSoftwareAuthenticator(
  options: SoftwareAuthenticatorOptions,
): SoftwareAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = randomBytes(32);
  const flags = FLAG_USER_PRESENT | ((options.userVerified ?? true) ? FLAG_USER_VERIFIED : 0);

  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');

  const authenticator: SoftwareAuthenticator = {
    credentialId: base64url(credentialId),
    counter: options.fixedCounter ?? 1,

    register(creation, overrides = {}) {
      const rpId = overrides.rpId ?? creation.rp.id ?? '';
      const clientDataJSON = clientData(
        'webauthn.create',
        creation.challenge,
        overrides.origin ?? options.origin,
      );
      const credentialIdLength = Buffer.alloc(2);
      credentialIdLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags | FLAG_ATTESTED_CREDENTIAL]),
        uint32(0),
        Buffer.alloc(16), // AAGUID: none
        credentialIdLength,
        credentialId,
        coseKey(publicKey),
      ]);
      const attestation = new Map<string, string | Uint8Array | Map<string, string>>();
      attestation.set('fmt', 'none');
      attestation.set('attStmt', new Map<string, string>());
      attestation.set('authData', Uint8Array.from(authData));
      const attestationObject = isoCBOR.encode(attestation);
      return {
        id: authenticator.credentialId,
        rawId: authenticator.credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(clientDataJSON),
          attestationObject: base64url(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },

    authenticate(request, overrides = {}) {
      const rpId = overrides.rpId ?? request.rpId ?? '';
      const clientDataJSON = clientData(
        'webauthn.get',
        overrides.challenge ?? request.challenge,
        overrides.origin ?? options.origin,
      );
      const counter = authenticator.counter;
      if (options.fixedCounter === undefined) {
        authenticator.counter += 1;
      }
      const authenticatorData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags]),
        uint32(counter),
      ]);
      const signature = sign(
        'sha256',
        Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
        privateKey,
      );
      return {
        id: authenticator.credentialId,
        rawId: authenticator.credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(authenticatorData),
          signature: base64url(signature),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
  return authenticator;
}

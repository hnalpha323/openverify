import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  FILE_KINDS,
  FILE_KINDS_BY_VERIFICATION_TYPE,
  FILE_KIND_FIELD,
  FILE_UPLOAD_FIELD,
  MAX_UPLOAD_BYTES,
  buildFileResource,
  detectImageMimeType,
  fileDocumentSchema,
  fileResourceSchema,
  isFileKindAllowed,
  maxUploadBytes,
  requiredFileKinds,
  detectUploadMimeType,
  ACCEPTED_UPLOAD_MIME_TYPES,
  CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE,
  SERVER_WRITTEN_FILE_KINDS,
  type FileKind,
} from './files.js';

/** C52.4: the chip files a client uploads (DG11 and DG12 are not taken in Phase 5). */
const CHIP_KINDS = [
  'chip-sod',
  'chip-dg1',
  'chip-dg2',
  'chip-dg14',
  'chip-dg15',
  'chip-card-security',
  'chip-card-access',
  'chip-com',
] as const satisfies readonly FileKind[];

/** The first tag of each chip file (ICAO Doc 9303-10). */
const CHIP_TAGS: Readonly<Record<(typeof CHIP_KINDS)[number], number>> = {
  'chip-sod': 0x77,
  'chip-dg1': 0x61,
  'chip-dg2': 0x75,
  'chip-dg14': 0x6e,
  'chip-dg15': 0x6f,
  'chip-card-security': 0x30,
  'chip-card-access': 0x31,
  'chip-com': 0x60,
};

/** One BER-TLV with `tag` and a `length`-byte value, its length short or long form. */
function tlv(tag: number, length: number): Uint8Array {
  const lengthBytes =
    length < 0x80
      ? [length]
      : length < 0x100
        ? [0x81, length]
        : length < 0x10000
          ? [0x82, length >> 8, length & 0xff]
          : [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff];
  return new Uint8Array([tag, ...lengthBytes, ...new Array<number>(length).fill(0x5a)]);
}
import { AT, AT_ISO, IDS } from './test-support.js';

const fileResource = {
  type: 'file',
  id: IDS.front,
  attributes: {
    kind: 'front',
    'mime-type': 'image/jpeg',
    'byte-size': 245_812,
    'created-at': AT_ISO,
    // C206 (Workflow 10B): client-reported, null when the client sent none.
    'capture-method': null,
    'capture-trigger': null,
  },
  relationships: {
    verification: { data: { type: 'verification/government-id', id: IDS.governmentId } },
  },
};

describe('file kinds (C3, C52.4)', () => {
  it('lists every kind, and the kinds each verification type owns', () => {
    expect(FILE_KINDS).toEqual([
      'front',
      'back',
      'portrait',
      'selfie-center',
      'selfie-left',
      'selfie-right',
      'document',
      'chip-sod',
      'chip-dg1',
      'chip-dg2',
      'chip-dg14',
      'chip-dg15',
      'chip-card-security',
      'chip-card-access',
      'chip-com',
      'document-preview',
      'chip-portrait',
    ]);
    expect(FILE_KINDS_BY_VERIFICATION_TYPE).toEqual({
      government_id: ['front', 'back', 'portrait'],
      selfie: ['selfie-center', 'selfie-left', 'selfie-right'],
      document: ['document', 'document-preview'],
      database: [],
      aamva: [],
      phone_number: [],
      email_address: [],
      government_id_nfc: [...CHIP_KINDS, 'chip-portrait'],
      crypto_wallet: [],
      database_business: [],
      business_website: [],
    });
  });

  it('keeps the server-written kinds out of what a client may upload (C52.4, P16)', () => {
    expect(SERVER_WRITTEN_FILE_KINDS).toEqual(['document-preview', 'chip-portrait']);
    for (const [type, kinds] of Object.entries(CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE)) {
      const all: readonly string[] =
        FILE_KINDS_BY_VERIFICATION_TYPE[type as keyof typeof FILE_KINDS_BY_VERIFICATION_TYPE];
      expect(kinds, type).toEqual(
        all.filter((kind) => !SERVER_WRITTEN_FILE_KINDS.includes(kind as never)),
      );
    }
    expect(CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE.document).toEqual(['document']);
    expect(CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE.government_id_nfc).toEqual(CHIP_KINDS);
    expect(isFileKindAllowed('document', 'document-preview')).toBe(false);
    expect(isFileKindAllowed('government_id_nfc', 'chip-portrait')).toBe(false);
    expect(isFileKindAllowed('document', 'document')).toBe(true);
    expect(isFileKindAllowed('government_id_nfc', 'chip-dg15')).toBe(true);
    expect(isFileKindAllowed('government_id', 'document')).toBe(false);
  });

  it('caps images and documents at 10 MiB, DG2 at 1 MiB and the other chip files at 64 KiB', () => {
    for (const kind of [
      'front',
      'selfie-center',
      'document',
      'document-preview',
      'chip-portrait',
    ] as const) {
      expect(maxUploadBytes(kind), kind).toBe(MAX_UPLOAD_BYTES);
    }
    expect(maxUploadBytes('chip-dg2')).toBe(1024 * 1024);
    for (const kind of CHIP_KINDS.filter((kind) => kind !== 'chip-dg2')) {
      expect(maxUploadBytes(kind), kind).toBe(64 * 1024);
    }
  });

  it('allows a kind only on its verification type', () => {
    expect(isFileKindAllowed('government_id', 'back')).toBe(true);
    expect(isFileKindAllowed('selfie', 'selfie-left')).toBe(true);
    expect(isFileKindAllowed('selfie', 'front')).toBe(false);
    expect(isFileKindAllowed('government_id', 'selfie-center')).toBe(false);
    expect(isFileKindAllowed('government_id', 'passport')).toBe(false);
    expect(isFileKindAllowed('document', 'front')).toBe(false);
  });

  it('names the multipart fields', () => {
    expect(FILE_UPLOAD_FIELD).toBe('file');
    expect(FILE_KIND_FIELD).toBe('kind');
  });
});

describe('requiredFileKinds', () => {
  const idStep = {
    id: 'government_id',
    type: 'government_id' as const,
    maxAttempts: 3,
    captureMethods: ['upload' as const],
  };

  it.each([
    ['front', ['front']],
    ['back', ['back']],
    ['both', ['front', 'back']],
  ] as const)('a government ID step with sides %s needs %j', (sides, expected) => {
    expect(requiredFileKinds({ ...idStep, sides })).toEqual(expected);
  });

  it('needs one selfie file per requested pose', () => {
    const step = { id: 'selfie', type: 'selfie', liveness: 'passive', maxAttempts: 3 } as const;
    expect(requiredFileKinds({ ...step, poses: ['center'] })).toEqual(['selfie-center']);
    expect(requiredFileKinds({ ...step, poses: ['center', 'left', 'right'] })).toEqual([
      'selfie-center',
      'selfie-left',
      'selfie-right',
    ]);
  });
});

describe('accepted uploads', () => {
  it('are JPEG, PNG or WebP up to 10 MiB', () => {
    expect(ACCEPTED_IMAGE_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it.each([
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00], 'image/png'],
    [
      'WebP',
      [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56],
      'image/webp',
    ],
  ])('sniffs %s by its magic bytes', (_name, bytes, expected) => {
    expect(detectImageMimeType(Uint8Array.from(bytes))).toBe(expected);
  });

  it.each([
    ['empty', []],
    ['truncated JPEG', [0xff, 0xd8]],
    ['truncated PNG', [0x89, 0x50, 0x4e, 0x47]],
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['RIFF that is not WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ['truncated WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42]],
  ])('rejects %s', (_name, bytes) => {
    expect(detectImageMimeType(Uint8Array.from(bytes))).toBeNull();
  });
});

describe('file resource', () => {
  it('describes an upload without its filename or contents', () => {
    expect(fileResourceSchema.parse(fileResource)).toEqual(fileResource);
    expect(fileDocumentSchema.parse({ data: fileResource })).toEqual({ data: fileResource });
  });

  it.each([
    ['a filename', { filename: 'jane-sample-passport.jpg' }],
    ['an unaccepted MIME type', { 'mime-type': 'image/gif' }],
    ['an empty file', { 'byte-size': 0 }],
    ['an oversized file', { 'byte-size': MAX_UPLOAD_BYTES + 1 }],
    ['an unknown kind', { kind: 'passport' }],
  ])('rejects %s', (_name, change) => {
    const value = { ...fileResource, attributes: { ...fileResource.attributes, ...change } };
    expect(fileResourceSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a kind that does not belong to the linked verification type', () => {
    const value = {
      ...fileResource,
      relationships: {
        verification: { data: { type: 'verification/selfie', id: IDS.selfie } },
      },
    };
    expect(fileResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from a storage record', () => {
    expect(
      buildFileResource({
        id: IDS.front,
        kind: 'front',
        mimeType: 'image/jpeg',
        byteSize: 245_812,
        createdAt: AT,
        captureMethod: null,
        captureTrigger: null,
        verification: { id: IDS.governmentId, type: 'government_id' },
      }),
    ).toEqual(fileResource);
  });

  it('refuses to build an invalid resource', () => {
    expect(() =>
      buildFileResource({
        id: IDS.front,
        kind: 'selfie-center',
        mimeType: 'image/jpeg',
        byteSize: 1,
        createdAt: AT,
        verification: { id: IDS.governmentId, type: 'government_id' },
      }),
    ).toThrow();
  });
});

describe('detectUploadMimeType (C52.4)', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const text = (value: string) => new TextEncoder().encode(value);

  it('types the image kinds as before, and refuses a PDF for them', () => {
    expect(detectUploadMimeType('front', jpeg)).toBe('image/jpeg');
    expect(detectUploadMimeType('selfie-left', png)).toBe('image/png');
    expect(detectUploadMimeType('front', text('%PDF-1.7\n'))).toBeNull();
    expect(detectUploadMimeType('back', tlv(0x77, 4))).toBeNull();
  });

  it('takes a document as an image, or as a PDF whose %PDF- header starts within the first 1,024 bytes', () => {
    expect(detectUploadMimeType('document', jpeg)).toBe('image/jpeg');
    expect(detectUploadMimeType('document', text('%PDF-1.7\n%...'))).toBe('application/pdf');
    expect(detectUploadMimeType('document', text(`${' '.repeat(1019)}%PDF-1.4`))).toBe(
      'application/pdf',
    );
    expect(detectUploadMimeType('document', text(`${' '.repeat(1020)}%PDF-1.4`))).toBeNull();
    expect(detectUploadMimeType('document', text('%PDF'))).toBeNull();
    expect(detectUploadMimeType('document', text('<html>%PDF-</html>'.repeat(1)))).toBe(
      'application/pdf',
    );
    expect(detectUploadMimeType('document', text('GIF89a'))).toBeNull();
    expect(detectUploadMimeType('document', tlv(0x77, 4))).toBeNull();
  });

  it.each(CHIP_KINDS)(
    'takes a %s file only with its first tag and a well-formed outer length',
    (kind) => {
      const tag = CHIP_TAGS[kind];
      for (const length of [0, 5, 127, 128, 255, 256, 4000]) {
        expect(detectUploadMimeType(kind, tlv(tag, length)), `${kind} ${String(length)}`).toBe(
          'application/octet-stream',
        );
      }
      const other = CHIP_KINDS.map((each) => CHIP_TAGS[each]).find((each) => each !== tag) ?? 0;
      expect(detectUploadMimeType(kind, tlv(other, 4))).toBeNull();
      const truncated = tlv(tag, 300).slice(0, 200);
      expect(detectUploadMimeType(kind, truncated)).toBeNull();
      const trailing = new Uint8Array([...tlv(tag, 4), 0x00]);
      expect(detectUploadMimeType(kind, trailing)).toBeNull();
      expect(detectUploadMimeType(kind, new Uint8Array([tag]))).toBeNull();
      expect(detectUploadMimeType(kind, new Uint8Array([tag, 0x80]))).toBeNull();
      expect(detectUploadMimeType(kind, new Uint8Array([tag, 0x85, 0, 0, 0, 0, 1, 0]))).toBeNull();
      expect(
        detectUploadMimeType(kind, new Uint8Array([tag, 0x81, 0x05, 1, 2, 3, 4, 5])),
      ).toBeNull();
      expect(detectUploadMimeType(kind, new Uint8Array([]))).toBeNull();
      expect(detectUploadMimeType(kind, jpeg)).toBeNull();
    },
  );

  it('types the server-written kinds as PNG images', () => {
    expect(detectUploadMimeType('document-preview', png)).toBe('image/png');
    expect(detectUploadMimeType('chip-portrait', png)).toBe('image/png');
    expect(detectUploadMimeType('chip-portrait', jpeg)).toBeNull();
  });

  it('lists every media type a file resource may carry', () => {
    expect(ACCEPTED_UPLOAD_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/octet-stream',
    ]);
  });
});

describe('requiredFileKinds of the Phase 5 steps (C52.4)', () => {
  it('needs the document of a document step and the SOD, DG1 and DG2 of an NFC step', () => {
    expect(
      requiredFileKinds({
        id: 'proof',
        type: 'document',
        documentTypes: ['utility_bill'],
        captureMethods: ['upload'],
      }),
    ).toEqual(['document']);
    expect(requiredFileKinds({ id: 'chip', type: 'nfc', androidOnly: true })).toEqual([
      'chip-sod',
      'chip-dg1',
      'chip-dg2',
    ]);
    expect(requiredFileKinds({ id: 'phone', type: 'phone_otp', allowedCountries: ['US'] })).toEqual(
      [],
    );
  });
});

describe('file resources of the Phase 5 kinds (C52.4)', () => {
  it('carry a PDF document or a chip file on their own verification type only', () => {
    const pdf = {
      ...fileResource,
      attributes: { ...fileResource.attributes, kind: 'document', 'mime-type': 'application/pdf' },
      relationships: {
        verification: { data: { type: 'verification/document', id: IDS.governmentId } },
      },
    };
    expect(fileResourceSchema.safeParse(pdf).success).toBe(true);
    const chip = {
      ...fileResource,
      attributes: {
        ...fileResource.attributes,
        kind: 'chip-sod',
        'mime-type': 'application/octet-stream',
      },
      relationships: {
        verification: { data: { type: 'verification/government-id-nfc', id: IDS.governmentId } },
      },
    };
    expect(fileResourceSchema.safeParse(chip).success).toBe(true);
    expect(
      fileResourceSchema.safeParse({
        ...chip,
        relationships: pdf.relationships,
      }).success,
    ).toBe(false);
    expect(
      fileResourceSchema.safeParse({
        ...pdf,
        attributes: { ...pdf.attributes, 'mime-type': 'text/html' },
      }).success,
    ).toBe(false);
  });
});

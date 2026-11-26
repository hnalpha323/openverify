/**
 * Test doubles for the worker, the event publisher and the webhook dispatcher. They hold
 * only synthetic data. Not used by production code paths.
 */
import { readFileSync } from 'node:fs';
import { PHASE1_CHECKS, type DefaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type {
  BackgroundComparison,
  DocumentAnalysis,
  FaceEmbeddingResult,
  FaceEmbeddingSubject,
  FileStorage,
  GovernmentIdAnalysis,
  SelfieAnalysis,
  SelfieSource,
  VisionClient,
  VisionDocument,
  VisionFace,
  VisionImage,
  VisionPortrait,
  VisionRendition,
} from '../ports.js';
import { VisionServiceError } from '../vision/index.js';
import type { JobQueue } from './queue.js';
import type { WorkerLogger } from './logger.js';

/** In-memory ciphertext storage. */
export function createMemoryStorage(): FileStorage & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: (key, ciphertext) => {
      objects.set(key, ciphertext);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}

export interface RecordedJob<Data> {
  name: string;
  data: Data;
  options: JobsOptions | undefined;
}

/**
 * A queue that records what was added and the ids removed; `fail` makes the next adds reject.
 */
export function createRecordingQueue<Data>(): JobQueue<Data> & {
  jobs: RecordedJob<Data>[];
  removed: string[];
  fail: Error | null;
  closed: boolean;
} {
  const queue = {
    jobs: [] as RecordedJob<Data>[],
    removed: [] as string[],
    fail: null as Error | null,
    closed: false,
    add(name: string, data: Data, options?: JobsOptions) {
      if (queue.fail !== null) {
        return Promise.reject(queue.fail);
      }
      queue.jobs.push({ name, data, options });
      return Promise.resolve();
    },
    remove(jobId: string) {
      queue.removed.push(jobId);
      return Promise.resolve(1);
    },
    close() {
      queue.closed = true;
      return Promise.resolve();
    },
  };
  return queue;
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  object: Record<string, unknown>;
  message: string;
}

/** A logger that keeps every entry, so tests can assert on what is (not) logged. */
export function createCapturingLogger(): WorkerLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const at =
    (level: LogEntry['level']) =>
    (object: Record<string, unknown>, message: string): void => {
      entries.push({ level, object, message });
    };
  return { entries, info: at('info'), warn: at('warn'), error: at('error') };
}

/** A synthetic golden fixture from `contracts/fixtures/vision` (C6, C32.1, C60). */
export function visionFixture(
  name:
    | 'analyze-government-id'
    | 'analyze-selfie'
    | 'embed-face'
    | 'analyze-document-pdf'
    | 'analyze-document-image'
    | 'embed-face-chip',
) {
  const url = new URL(`../../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

// A fake vision client --------------------------------------------------------

/** A vision answer, or the error the call rejects with. */
export type VisionAnswer<T> = T | Error;

export interface FakeVisionCall {
  endpoint:
    | 'government-id'
    | 'selfie'
    | 'embed-face'
    | 'compare-background'
    | 'analyze-document'
    | 'render-document-page'
    | 'convert-portrait'
    | 'mask-background'
    | 'create-rendition';
  images: Record<string, { mimeType: string; bytes: number[] }>;
  /** `embed-face` only, and only when the caller named one (K101, C60.4 `chip`). */
  subject?: FaceEmbeddingSubject;
  /** `selfie` only, and only when the caller named one (C41.1). */
  source?: SelfieSource;
  /** `render-document-page` only (C60.4). */
  page?: number;
}

/** The C60.1 golden PDF document analysis, a fresh copy. */
export function documentAnalysisFixture(
  name: 'analyze-document-pdf' | 'analyze-document-image' = 'analyze-document-pdf',
): DocumentAnalysis {
  return visionFixture(name) as DocumentAnalysis;
}

/** The 8-byte PNG signature and a 1 x 1 IHDR: the smallest PNG header a fake answers with. */
export const FAKE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

/** The C32 government ID golden fixture, a fresh copy. */
export function governmentIdFixture(): GovernmentIdAnalysis {
  return visionFixture('analyze-government-id') as GovernmentIdAnalysis;
}

/** The C6 selfie golden fixture, a fresh copy. */
export function selfieFixture(): SelfieAnalysis {
  return visionFixture('analyze-selfie') as SelfieAnalysis;
}

/** A `/v1/embed/face` answer for `face` (the golden fixture's model versions). */
export function embedFaceAnswer(face: VisionFace | null): FaceEmbeddingResult {
  const recorded = visionFixture('embed-face') as FaceEmbeddingResult;
  return { ...recorded, face, face_count: face === null ? 0 : 1 };
}

export interface FakeVisionAnswers {
  governmentId: VisionAnswer<GovernmentIdAnalysis>;
  selfie: VisionAnswer<SelfieAnalysis>;
  /** One answer for every image, or one per image. */
  embedFace:
    VisionAnswer<FaceEmbeddingResult> | ((image: VisionImage) => VisionAnswer<FaceEmbeddingResult>);
  /** C41.2: one answer, or one per number of candidates sent. */
  compareBackground:
    | VisionAnswer<BackgroundComparison>
    | ((candidates: number) => VisionAnswer<BackgroundComparison>);
  /** C60.1, C60.4 (Workflow 5B). */
  analyzeDocument: VisionAnswer<DocumentAnalysis>;
  renderDocumentPage: VisionAnswer<Uint8Array>;
  convertPortrait: VisionAnswer<Uint8Array>;
  /** C99.7 (Workflow 7B). */
  maskBackground: VisionAnswer<Uint8Array>;
  /** C135.3 (Workflow 8B): 501 `not_implemented` until a test gives an answer, as the stub does. */
  createRendition: VisionAnswer<VisionRendition>;
}

/** A background comparison that verifies nothing: no match for any of `candidates`. */
export const noBackgroundMatch = (candidates: number): BackgroundComparison => ({
  results: Array.from({ length: candidates }, (_, index) => ({
    index,
    good_matches: 0,
    inliers: 0,
    inlier_ratio: 0,
  })),
});

/**
 * A vision client answering with recorded C32 answers, recording what it received. By default
 * an embedded face is the golden ID front's portrait, as a re-embedding of that front would be.
 */
export function createFakeVision(): {
  client: VisionClient;
  answers: FakeVisionAnswers;
  calls: FakeVisionCall[];
} {
  const answers: FakeVisionAnswers = {
    governmentId: governmentIdFixture(),
    selfie: selfieFixture(),
    embedFace: embedFaceAnswer(governmentIdFixture().sides.front.portrait),
    compareBackground: noBackgroundMatch,
    analyzeDocument: documentAnalysisFixture(),
    renderDocumentPage: FAKE_PNG,
    convertPortrait: FAKE_PNG,
    maskBackground: FAKE_PNG,
    createRendition: new VisionServiceError('/v1/renditions', 501, 'not_implemented'),
  };
  const calls: FakeVisionCall[] = [];
  const record = (
    endpoint: FakeVisionCall['endpoint'],
    images: Record<string, VisionImage | VisionDocument | VisionPortrait | undefined>,
    extra: {
      subject?: FaceEmbeddingSubject | undefined;
      source?: SelfieSource | undefined;
      page?: number | undefined;
    } = {},
  ) => {
    const copied: FakeVisionCall['images'] = {};
    for (const [field, image] of Object.entries(images)) {
      if (image !== undefined) {
        copied[field] = { mimeType: image.mimeType, bytes: [...image.bytes] };
      }
    }
    calls.push({
      endpoint,
      images: copied,
      ...(extra.subject === undefined ? {} : { subject: extra.subject }),
      ...(extra.source === undefined ? {} : { source: extra.source }),
      ...(extra.page === undefined ? {} : { page: extra.page }),
    });
  };
  const answer = <T>(value: VisionAnswer<T>): Promise<T> =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(structuredClone(value));
  const client: VisionClient = {
    analyzeGovernmentId: (input) => {
      record('government-id', input);
      return answer(answers.governmentId);
    },
    analyzeSelfie: (input) => {
      const { center, left, right, source } = input;
      record('selfie', { center, left, right }, { source });
      return answer(answers.selfie);
    },
    compareBackground: ({ probe, candidates }) => {
      record('compare-background', {
        probe,
        ...Object.fromEntries(
          candidates.map((image, index) => [`candidate_${String(index)}`, image]),
        ),
      });
      const { compareBackground } = answers;
      return answer(
        typeof compareBackground === 'function'
          ? compareBackground(candidates.length)
          : compareBackground,
      );
    },
    embedFace: ({ image, subject }) => {
      record('embed-face', { image }, { subject });
      const { embedFace } = answers;
      return answer(typeof embedFace === 'function' ? embedFace(image as VisionImage) : embedFace);
    },
    analyzeDocument: ({ document }) => {
      record('analyze-document', { document });
      return answer(answers.analyzeDocument);
    },
    renderDocumentPage: ({ document, page }) => {
      record('render-document-page', { document }, { page });
      return answer(answers.renderDocumentPage);
    },
    convertPortrait: ({ portrait }) => {
      record('convert-portrait', { portrait });
      return answer(answers.convertPortrait);
    },
    maskBackground: ({ image }) => {
      record('mask-background', { image });
      return answer(answers.maskBackground);
    },
    createRendition: ({ source }) => {
      record('create-rendition', { source });
      return answer(answers.createRendition);
    },
  };
  return { client, answers, calls };
}

/**
 * The default template as Phase 3 shipped it for the selfie: a passive centre step and the three
 * Phase 1 selfie checks, required. Since Phase 4 it is the documented workaround for users who
 * cannot turn their head; the Phase 1-3 tests keep it, and the C45.1 default is tested in
 * `process-selfie.test.ts`, `selfie-contract.test.ts` and the worker's integration test.
 */
export function phase3SelfieTemplate(
  template: DefaultInquiryTemplateAttributes,
): DefaultInquiryTemplateAttributes {
  const copy = structuredClone(template);
  copy.flow.steps = copy.flow.steps.map((step) =>
    step.type === 'selfie' ? { ...step, poses: ['center'], liveness: 'passive' } : step,
  );
  copy['verification-config'].selfie = {
    checks: Object.fromEntries(
      PHASE1_CHECKS.selfie.map((id) => [id, { enabled: true, required: true }]),
    ),
  };
  return copy;
}

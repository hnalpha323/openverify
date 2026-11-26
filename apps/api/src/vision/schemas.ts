/**
 * zod schemas of the vision service responses (contracts C6 and C32.1), mirroring the service's
 * pydantic models field for field: strict objects, finite numbers, `null` (never absent) for
 * missing parts, and 128-value unit-norm embeddings. They are checked against
 * `contracts/fixtures/vision/*.json`, the same golden files the service validates.
 */
import { z } from 'zod';
import type {
  BackgroundComparison,
  DocumentAnalysis,
  FaceEmbeddingResult,
  GovernmentIdAnalysis,
  SelfieAnalysis,
} from '../ports.js';

export const EMBEDDING_DIMENSIONS = 128;
/** Embeddings are L2-normalised; allowed deviation of their norm from 1 (as the service). */
export const UNIT_NORM_TOLERANCE = 1e-3;

const unitInterval = z.number().min(0).max(1);

export const modelVersionsSchema = z
  .object({ detector: z.string().min(1), recognizer: z.string().min(1) })
  .catchall(z.string());

export const visionQualitySchema = z.strictObject({
  blur_score: z.number().min(0),
  is_blurry: z.boolean(),
  glare_ratio: unitInterval,
  has_glare: z.boolean(),
  brightness: unitInterval,
  is_too_dark: z.boolean(),
  is_too_bright: z.boolean(),
});

/** `[x, y, width, height]`; x and y may be negative when a face crosses the image edge. */
export const boundingBoxSchema = z
  .tuple([z.number(), z.number(), z.number().positive(), z.number().positive()])
  .readonly();

export const detectedFaceSchema = z.strictObject({
  bbox: boundingBoxSchema,
  score: unitInterval,
});

/** Unit-norm check, skipped when the length is already wrong (one issue per problem). */
const embeddingSchema = z
  .array(z.number())
  .length(EMBEDDING_DIMENSIONS)
  .refine(
    (values) =>
      values.length !== EMBEDDING_DIMENSIONS ||
      Math.abs(Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) - 1) <=
        UNIT_NORM_TOLERANCE,
    { message: 'must be a unit vector' },
  )
  .readonly();

export const embeddedFaceSchema = z.strictObject({
  ...detectedFaceSchema.shape,
  embedding: embeddingSchema,
});

// C32.1: government ID analysis v2 ------------------------------------------------------------
// Vision measures; the checks decide (C32.2). Nulls mean "not measured", never a default.

/** C32.1 limits, as the service enforces them. */
export const MAX_TEXT_LINES = 200;
export const MAX_TEXT_LENGTH = 200;
export const MAX_MRZ_LINES = 3;
export const MAX_MRZ_LINE_LENGTH = 64;
export const MAX_BARCODES = 8;

const nonNegative = z.number().min(0);
const positiveInt = z.int().positive();
const pointSchema = z.tuple([z.number(), z.number()]).readonly();
/** Four corners clockwise from the top left, in pixels of the EXIF-upright upload. */
export const quadSchema = z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]).readonly();

export const documentDetectionSchema = z
  .strictObject({
    found: z.boolean(),
    quad: quadSchema.nullable(),
    // Phase 12A V2 and C12: `text_layout` is an outline fitted from the text lines and portrait.
    method: z.enum(['contour', 'lines', 'full_frame', 'text_layout', 'none']),
    rectified_size: z.tuple([positiveInt, positiveInt]).readonly().nullable(),
    aspect_ratio: nonNegative.nullable(),
    area_ratio: unitInterval.nullable(),
  })
  .refine((value) => value.found === (value.method !== 'none'), {
    message: 'found must be true exactly when method is not none',
  })
  .refine(
    (value) =>
      value.found
        ? value.quad !== null && value.rectified_size !== null
        : value.quad === null && value.rectified_size === null,
    { message: 'a found document has a quad and a rectified size, and only then' },
  );

export const documentQualitySchema = z.strictObject({
  blur_score: nonNegative,
  tenengrad: nonNegative,
  width_px: positiveInt,
  height_px: positiveInt,
  glare_ratio_text: unitInterval.nullable(),
  glare_ratio_portrait: unitInterval.nullable(),
});

export const textLineSchema = z.strictObject({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  confidence: unitInterval,
  box: boundingBoxSchema,
  stroke_width_mean: nonNegative.nullable(),
  stroke_width_cv: nonNegative.nullable(),
});

const mrzLineSchema = z
  .string()
  .regex(new RegExp(`^[A-Z0-9<]{1,${String(MAX_MRZ_LINE_LENGTH)}}$`), 'must be A-Z, 0-9 or <');

export const mrzReadingSchema = z
  .strictObject({
    found: z.boolean(),
    format_guess: z.enum(['TD1', 'TD2', 'TD3', 'MRVA', 'MRVB']).nullable(),
    lines: z.array(mrzLineSchema).max(MAX_MRZ_LINES).readonly(),
    line_confidences: z.array(unitInterval).max(MAX_MRZ_LINES).readonly(),
    box: boundingBoxSchema.nullable(),
  })
  .refine((value) => value.line_confidences.length === value.lines.length, {
    message: 'every MRZ line has one confidence',
  })
  .refine(
    (value) =>
      value.found ||
      (value.lines.length === 0 && value.box === null && value.format_guess === null),
    { message: 'an MRZ not found has no lines, box or format' },
  );

export const barcodeSchema = z.strictObject({
  format: z.string().min(1).max(32),
  bytes_b64: z
    .string()
    .max(8192)
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'must be base64'),
  text: z.string().max(4096),
  quad: quadSchema,
});

export const portraitClaritySchema = z.strictObject({
  face_width_px: nonNegative,
  sharpness: nonNegative,
  landmarks_score: unitInterval,
});

export const forensicsSchema = z.strictObject({
  /** GPS values never leave the service: only whether the upload carried them. */
  exif: z.strictObject({
    software: z.string().max(256).nullable(),
    make: z.string().max(256).nullable(),
    model: z.string().max(256).nullable(),
    has_gps: z.boolean(),
  }),
  jpeg: z
    .strictObject({
      quality_estimate: z.int().min(1).max(100).nullable(),
      standard_tables: z.boolean().nullable(),
      double_compression_score: unitInterval.nullable(),
    })
    .nullable(),
  ela_score: unitInterval,
  moire_score: unitInterval,
  screen_grid_score: unitInterval,
  chroma: z.strictObject({ mean_saturation: unitInterval, colorfulness: nonNegative }),
  color_cast_score: unitInterval,
  copy_move_score: unitInterval,
  portrait_boundary_score: unitInterval.nullable(),
  star_glyph: z
    .strictObject({ found: z.boolean(), score: unitInterval, box: boundingBoxSchema.nullable() })
    .refine((value) => value.found || value.box === null, {
      message: 'a star glyph not found has no box',
    }),
});

const sideSchema = z.strictObject({
  quality: visionQualitySchema,
  faces: z.array(detectedFaceSchema).readonly(),
  portrait: embeddedFaceSchema.nullable(),
  document: documentDetectionSchema,
  document_quality: documentQualitySchema.nullable(),
  text: z.array(textLineSchema).max(MAX_TEXT_LINES).readonly(),
  mrz: mrzReadingSchema,
  barcodes: z.array(barcodeSchema).max(MAX_BARCODES).readonly(),
  portrait_clarity: portraitClaritySchema.nullable(),
  forensics: forensicsSchema.nullable(),
  phash: z
    .string()
    .regex(/^[0-9a-f]{16}$/, 'must be 16 lowercase hex characters')
    .nullable(),
});

/**
 * The C6 model versions plus the OCR models (C32.1), `null` while no OCR model ran. Further
 * model names are accepted, as for C6.
 */
export const governmentIdModelVersionsSchema = z
  .object({
    detector: z.string().min(1),
    recognizer: z.string().min(1),
    text_detector: z.string().min(1).nullable(),
    text_recognizer: z.string().min(1).nullable(),
  })
  .catchall(z.string());

// C41.1: selfie analysis v2 (Phase 4). Vision measures; every part it could not measure is null.
const cosine = z.number().min(-1).max(1);

const selfieFaceSchema = detectedFaceSchema.extend({
  landmarks: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema, pointSchema]).readonly(),
});

const faceQualitySchema = z.strictObject({
  box: boundingBoxSchema,
  width_px: nonNegative,
  height_ratio: unitInterval,
  center_offset: z.tuple([z.number(), z.number()]).readonly(),
  blur_score: nonNegative,
  brightness: unitInterval,
  glare_ratio: unitInterval,
});

const headPoseSchema = z.strictObject({
  yaw_ratio: z.number(),
  roll_deg: z.number(),
  yaw_deg: z.number().nullable(),
  pitch_deg: z.number().nullable(),
  method: z.literal('yunet-5pt'),
});

const passiveLivenessSchema = z.strictObject({
  v2: unitInterval,
  v1se: unitInterval,
  mean: unitInterval,
  effective_scales: z.strictObject({ v2: nonNegative, v1se: nonNegative }),
});

const occlusionSchema = z.strictObject({
  covering: z.strictObject({
    score: unitInterval,
    skin_fraction_ratio: nonNegative,
    texture_ratio: nonNegative,
    delta_e: nonNegative,
    forehead_valid: z.boolean(),
  }),
  glasses: z.strictObject({
    score: unitInterval,
    rim_edge_energy: nonNegative,
    lens_highlight_ratio: unitInterval,
    bridge_edge_density: unitInterval,
  }),
});

const syntheticSchema = z.strictObject({
  spectral_tail_deviation: z.number().nullable(),
  residual_peak_ratio: z.number().nullable(),
  noise_inconsistency: z.number().nullable(),
  jpeg_grid_misalignment: z.number().nullable(),
  canonical_landmark_distance: z.number().nullable(),
  digital_source_type: z.string().max(128).nullable(),
});

const backgroundSchema = z.strictObject({
  layout: z.array(z.number()).length(144).readonly(),
  valid_cells: z.string().regex(/^[01]{48}$/),
  coverage: unitInterval,
});

const consistencySchema = z.strictObject({
  pose: z.enum(['left', 'right']),
  face_cosine_to_center: cosine.nullable(),
  planarity: z
    .strictObject({
      tracked_points: z.int().min(0),
      median_residual_ratio: nonNegative,
      p90_residual_ratio: nonNegative,
    })
    .nullable(),
  registered_ssim: cosine.nullable(),
  raw_ssim: cosine.nullable(),
  duplicate_of_center: z.boolean().nullable(),
});

const poseSchema = z.strictObject({
  quality: visionQualitySchema,
  faces: z.array(selfieFaceSchema).readonly(),
  face: embeddedFaceSchema.nullable(),
  image: z.strictObject({ width: z.int().positive(), height: z.int().positive() }),
  face_quality: faceQualitySchema.nullable(),
  head_pose: headPoseSchema.nullable(),
  passive_liveness: passiveLivenessSchema.nullable(),
  occlusion: occlusionSchema.nullable(),
  synthetic: syntheticSchema.nullable(),
  background: backgroundSchema.nullable(),
});

const selfieModelVersionsSchema = z.strictObject({
  detector: z.string().min(1),
  recognizer: z.string().min(1),
  anti_spoof_v2: z.string().min(1).nullable(),
  anti_spoof_v1se: z.string().min(1).nullable(),
});

/** `POST /v1/analyze/government-id` (C6, C32.1). */
export const governmentIdAnalysisSchema = z.strictObject({
  model_versions: governmentIdModelVersionsSchema,
  sides: z.strictObject({ front: sideSchema, back: sideSchema.nullable() }),
}) satisfies z.ZodType<GovernmentIdAnalysis>;

/** `POST /v1/analyze/selfie`. */
export const selfieAnalysisSchema = z.strictObject({
  model_versions: selfieModelVersionsSchema,
  poses: z.strictObject({
    center: poseSchema,
    left: poseSchema.nullable(),
    right: poseSchema.nullable(),
  }),
  consistency: z.array(consistencySchema).max(2).readonly(),
}) satisfies z.ZodType<SelfieAnalysis>;

/** `POST /v1/compare/background` (C41.2). */
export const backgroundComparisonSchema = z.strictObject({
  results: z
    .array(
      z.strictObject({
        index: z.int().min(0).max(4),
        good_matches: z.int().min(0),
        inliers: z.int().min(0),
        inlier_ratio: unitInterval,
      }),
    )
    .max(5)
    .readonly(),
}) satisfies z.ZodType<BackgroundComparison>;

/** `POST /v1/embed/face`. */
export const faceEmbeddingResultSchema = z.strictObject({
  model_versions: modelVersionsSchema,
  face: embeddedFaceSchema.nullable(),
  face_count: z.int().min(0),
}) satisfies z.ZodType<FaceEmbeddingResult>;

// C60.1, C60.4: document analysis --------------------------------------------------------------
// Vision measures; the document checks classify, extract and decide (C60.5, C60.6). Mirrors the
// service's pydantic models field for field (`services/vision/src/openverify_vision/schemas.py`).

/** C60.1 limits, as the service enforces them. */
export const MAX_DOCUMENT_PAGES = 50;
export const MAX_ANALYSED_PAGES = 4;
export const MAX_DOCUMENT_LINES = 600;
export const MAX_DOCUMENT_LINE_LENGTH = 300;
export const MAX_PAGE_SIDE_PT = 14_400;
const MAX_LINE_FONTS = 16;
const MAX_PDF_FONTS = 256;
const MAX_PDF_STRING_LENGTH = 256;
const MAX_XMP_HISTORY = 32;

/** The bounds of the PNG answers (C60.4, C99.7), as `contracts/fixtures/vision/png-limits.json`. */
export const RENDER_MAX_SIDE_PX = 1600;
export const PORTRAIT_MAX_SIDE_PX = 640;
export const MASKED_BACKGROUND_MAX_SIDE_PX = 640;

/** The `code` of each 422 of the document routes (C60.1). */
export const DOCUMENT_PROBLEM_CODES = [
  'pdf_encrypted',
  'pdf_unprocessable',
  'too_many_pages',
] as const;
export type DocumentProblemCode = (typeof DOCUMENT_PROBLEM_CODES)[number];
/** The `code` of the 503 when the guarded child was killed or timed out (C60.1). */
export const GUARDED_WORKER_FAILED = 'guarded_worker_failed';

/**
 * Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"):
 * `POST /v1/count/document-pages`, a PDF's page count from vision's guarded child, bounded as
 * `contracts/fixtures/vision/pdf-page-count.json` states (vision exports it, rule 28). The largest
 * PDF it counts is the transactions' file ceiling; it refuses with `DOCUMENT_PROBLEM_CODES`.
 */
export const PAGE_COUNT_MAX_PAGES = 10_000;
export const pageCountSchema = z.strictObject({
  page_count: z.int().min(1).max(PAGE_COUNT_MAX_PAGES),
});

/** C60.1: the pages analysed, 1-based: the first three and the last. */
export function analysedPageNumbers(pageCount: number): number[] {
  const first = Array.from({ length: Math.min(pageCount, 3) }, (_, index) => index + 1);
  return first.includes(pageCount) ? first : [...first, pageCount];
}

const count = z.int().min(0);
const shortText = z.string().max(MAX_PDF_STRING_LENGTH);
const lineText = z.string().min(1).max(MAX_DOCUMENT_LINE_LENGTH);
const isoDate = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)?$/, 'must be ISO 8601');
const pageSidePt = z.number().gt(0).max(MAX_PAGE_SIDE_PT);

const textLayerLineSchema = z
  .strictObject({
    text: lineText,
    box: boundingBoxSchema,
    font_ids: z.array(count).max(MAX_LINE_FONTS).readonly(),
    font_size_pt: nonNegative.nullable(),
    visible: z.boolean(),
    hidden_reason: z
      .enum([
        'render_mode_invisible',
        'clipped',
        'off_page',
        'covered',
        'background_fill',
        'too_small',
      ])
      .nullable(),
  })
  .refine((line) => line.visible === (line.hidden_reason === null), {
    message: 'hidden_reason is null exactly when the line is visible',
  });

const documentOcrLineSchema = z.strictObject({
  text: lineText,
  confidence: unitInterval,
  box: boundingBoxSchema,
});

const documentPageSchema = z
  .strictObject({
    number: z.int().min(1).max(MAX_DOCUMENT_PAGES),
    width: positiveInt,
    height: positiveInt,
    width_pt: pageSidePt.nullable(),
    height_pt: pageSidePt.nullable(),
    text_layer: z.array(textLayerLineSchema).max(MAX_DOCUMENT_LINES).readonly(),
    ocr: z.array(documentOcrLineSchema).max(MAX_DOCUMENT_LINES).readonly(),
    text_layer_ocr_agreement: unitInterval.nullable(),
  })
  .refine((page) => (page.width_pt === null) === (page.height_pt === null), {
    message: 'width_pt and height_pt are both set or both null',
  })
  .refine(
    (page) =>
      page.text_layer_ocr_agreement === null || (page.text_layer.length > 0 && page.ocr.length > 0),
    { message: 'text_layer_ocr_agreement needs both a text layer and OCR lines' },
  );

const xmpFieldsSchema = z.strictObject({
  creator_tool: shortText.nullable(),
  producer: shortText.nullable(),
  create_date: isoDate.nullable(),
  modify_date: isoDate.nullable(),
  metadata_date: isoDate.nullable(),
  document_id: shortText.nullable(),
  instance_id: shortText.nullable(),
  history_agents: z.array(shortText).max(MAX_XMP_HISTORY).readonly(),
});

const pdfFontSchema = z.strictObject({
  id: count,
  base_name: z.string().min(1).max(128),
  subset_tag: z
    .string()
    .regex(/^[A-Z]{6}$/, 'must be six capitals')
    .nullable(),
  embedded: z.boolean(),
});

const pdfMeasurementsSchema = z
  .strictObject({
    producer: shortText.nullable(),
    creator: shortText.nullable(),
    creation_date: isoDate.nullable(),
    modification_date: isoDate.nullable(),
    xmp: xmpFieldsSchema.nullable(),
    linearized: z.boolean(),
    revisions: z.int().min(1),
    xref_repaired: z.boolean(),
    eof_markers: count,
    bytes_after_last_eof: count,
    object_streams: count,
    fonts: z.array(pdfFontSchema).max(MAX_PDF_FONTS).readonly(),
    annotations: count,
    form_fields: count,
    actions: z.strictObject({
      javascript: count,
      launch: count,
      submit_form: count,
      goto_remote: count,
      rich_media: count,
      embedded_files: count,
    }),
    signatures: count,
    edits_after_signature: z.boolean(),
  })
  .refine((pdf) => pdf.fonts.every((font, index) => font.id === index), {
    message: "each font's id is its position in fonts",
  })
  .refine((pdf) => !pdf.edits_after_signature || pdf.signatures > 0, {
    message: 'edits_after_signature needs a signature',
  });

const documentImageMeasurementsSchema = z.strictObject({
  exif_software: shortText.nullable(),
  exif_datetime_original: isoDate.nullable(),
  exif_datetime: isoDate.nullable(),
  jpeg_quality: z.int().min(1).max(100).nullable(),
  double_compression_score: unitInterval.nullable(),
  ela_text_cell_score: unitInterval.nullable(),
  copy_move_score: unitInterval.nullable(),
});

const optionalName = z.string().min(1).nullable();

/** `POST /v1/analyze/document` (C60.1). */
export const documentAnalysisSchema = z
  .strictObject({
    model_versions: z.strictObject({
      text_detector: optionalName,
      text_recognizer: optionalName,
      pdf_renderer: optionalName,
      pdf_parser: optionalName,
    }),
    source: z.enum(['pdf', 'image']),
    page_count: z.int().min(1).max(MAX_DOCUMENT_PAGES),
    analysed_pages: z.array(z.int()).min(1).max(MAX_ANALYSED_PAGES).readonly(),
    pages: z.array(documentPageSchema).min(1).max(MAX_ANALYSED_PAGES).readonly(),
    pdf: pdfMeasurementsSchema.nullable(),
    image: documentImageMeasurementsSchema.nullable(),
  })
  .superRefine((document, context) => {
    const issue = (message: string) => {
      context.addIssue({ code: 'custom', message });
    };
    const expected = analysedPageNumbers(document.page_count);
    if (document.analysed_pages.join(',') !== expected.join(',')) {
      issue('analysed_pages are the first three pages and the last');
    }
    if (document.pages.map((page) => page.number).join(',') !== document.analysed_pages.join(',')) {
      issue('pages holds one entry per analysed page, in order');
    }
    if ((document.source === 'pdf') !== (document.pdf !== null)) {
      issue('pdf is set exactly when the source is a PDF');
    }
    if (
      document.source === 'image' &&
      (document.page_count !== 1 || document.pages.some((page) => page.text_layer.length > 0))
    ) {
      issue('a photo is one page without a text layer');
    }
    if (document.pages.some((page) => (page.width_pt === null) !== (document.source === 'image'))) {
      issue('a PDF page has a page box in points and a photo has none');
    }
  }) satisfies z.ZodType<DocumentAnalysis>;

// C135.3 (Workflow 8B): renditions ---------------------------------------------------------------
// `POST /v1/renditions` answers what a reviewer may see of a file: an image upright and without
// metadata, or a PDF's first pages as PNG images, as `contracts/fixtures/vision/rendition-*.json`.

/** A PDF's first 20 pages are rendered; `truncated` says the source holds more. */
export const RENDITION_MAX_PAGES = 20;
/** Provisional: an image rendition's longest side; a 12 MP phone photo keeps its size. */
export const RENDITION_IMAGE_MAX_SIDE_PX = 4096;
/** Provisional: one rendition's bytes, before base64. */
export const RENDITION_MAX_BYTES = 16 * 1024 * 1024;

/** One character class, so a 22 MB string never builds a backtracking stack. */
const BASE64_CHARACTERS = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_START = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, start: readonly number[]) =>
  start.every((byte, index) => bytes[index] === byte);

/** The width and height a PNG's IHDR holds, or `null` when the bytes are not a PNG. */
function ihdrSize(bytes: Uint8Array): readonly [number, number] | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG_START)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  return type === 'IHDR' ? [view.getUint32(16), view.getUint32(20)] : null;
}

export const renditionPageSchema = z
  .strictObject({
    page: z.int().min(1).max(RENDITION_MAX_PAGES),
    media_type: z.enum(['image/jpeg', 'image/png']),
    width: z.int().min(1).max(RENDITION_IMAGE_MAX_SIDE_PX),
    height: z.int().min(1).max(RENDITION_IMAGE_MAX_SIDE_PX),
    byte_size: z.int().min(1).max(RENDITION_MAX_BYTES),
    data_b64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(RENDITION_MAX_BYTES / 3)),
  })
  .superRefine((page, context) => {
    const issue = (message: string) => {
      context.addIssue({ code: 'custom', message, path: ['data_b64'] });
    };
    if (page.data_b64.length % 4 !== 0 || !BASE64_CHARACTERS.test(page.data_b64)) {
      issue('data_b64 must be standard base64');
      return;
    }
    const bytes = new Uint8Array(Buffer.from(page.data_b64, 'base64'));
    if (bytes.length !== page.byte_size) {
      issue('byte_size is the decoded length of data_b64');
    } else if (page.media_type === 'image/png') {
      const size = ihdrSize(bytes);
      if (size?.[0] !== page.width || size[1] !== page.height) {
        issue("a PNG rendition's IHDR holds its width and height");
      }
    } else if (!startsWith(bytes, JPEG_START)) {
      issue('a JPEG rendition starts with a JPEG start of image');
    }
  });
export type RenditionPageResponse = z.infer<typeof renditionPageSchema>;

/** The service's `Rendition` model, field for field. */
export const renditionSchema = z
  .strictObject({
    source: z.enum(['image', 'pdf']),
    page_count: z.int().min(1),
    truncated: z.boolean(),
    pages: z.array(renditionPageSchema).min(1).max(RENDITION_MAX_PAGES),
  })
  .superRefine((rendition, context) => {
    const issue = (message: string) => {
      context.addIssue({ code: 'custom', message });
    };
    if (rendition.pages.some((page, index) => page.page !== index + 1)) {
      issue('pages are numbered from 1, in order');
    }
    if (rendition.pages.length !== Math.min(rendition.page_count, RENDITION_MAX_PAGES)) {
      issue('every page is rendered, up to 20');
    }
    if (rendition.truncated !== rendition.page_count > RENDITION_MAX_PAGES) {
      issue('truncated says the source holds more pages than were rendered');
    }
    if (rendition.source === 'image' && rendition.page_count !== 1) {
      issue('an image is one page');
    }
    if (
      rendition.source === 'pdf' &&
      rendition.pages.some(
        (page) =>
          page.media_type !== 'image/png' || Math.max(page.width, page.height) > RENDER_MAX_SIDE_PX,
      )
    ) {
      issue("a PDF's pages are PNG images of at most 1,600 px a side");
    }
  });
export type RenditionResponse = z.infer<typeof renditionSchema>;

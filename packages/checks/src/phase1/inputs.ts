/**
 * The vision results the evaluators read. These are structural subsets of the C6 and C32.1
 * responses (`apps/api/src/ports.ts`, validated with zod by the API's vision client), so the
 * checks stay pure and do not depend on the API. The C32.1 fields of a side are optional here so
 * that Phase 1 inputs still type; absent or `null` means "not measured", never a default.
 */

/** Whole-image quality metrics and the vision service's threshold verdicts. */
export interface VisionQualityInput {
  blur_score: number;
  is_blurry: boolean;
  glare_ratio: number;
  has_glare: boolean;
  /** Mean brightness in [0, 1]. */
  brightness: number;
  is_too_dark: boolean;
  is_too_bright: boolean;
}

export interface VisionFaceInput {
  /** `[x, y, width, height]` in pixels. */
  bbox: readonly number[];
  /** Detector confidence in [0, 1]. */
  score: number;
  /**
   * C41.1 selfie faces: YuNet's five `[x, y]` points (right eye, left eye, nose tip, right and
   * left mouth corners), in image pixels. Biometric: never copied into a result.
   */
  landmarks?: readonly VisionPointInput[] | undefined;
}

export interface VisionEmbeddedFaceInput extends VisionFaceInput {
  /** 128-dimension SFace embedding: biometric data, never copied into a result. */
  embedding: readonly number[];
}

/** `[x, y, width, height]` in pixels. */
export type VisionBoxInput = readonly [x: number, y: number, width: number, height: number];
export type VisionPointInput = readonly [x: number, y: number];
/** Four corners clockwise from the top left, in pixels of the upload (C32.1). */
export type VisionQuadInput = readonly [
  VisionPointInput,
  VisionPointInput,
  VisionPointInput,
  VisionPointInput,
];

/** C32.1 `document`. */
export interface DocumentDetectionInput {
  found: boolean;
  quad: VisionQuadInput | null;
  /** `text_layout` (Phase 12A): an outline fitted from the text lines and the portrait. */
  method: 'contour' | 'lines' | 'full_frame' | 'text_layout' | 'none';
  rectified_size: readonly [width: number, height: number] | null;
  aspect_ratio: number | null;
  area_ratio: number | null;
}

/** C32.1 `document_quality`, measured on the rectified document. */
export interface DocumentQualityInput {
  blur_score: number;
  tenengrad: number;
  width_px: number;
  height_px: number;
  glare_ratio_text: number | null;
  glare_ratio_portrait: number | null;
}

/** One OCR line of the visual zone (PII), its box in rectified pixels when a document was found. */
export interface TextLineInput {
  text: string;
  confidence: number;
  box: VisionBoxInput;
  stroke_width_mean: number | null;
  stroke_width_cv: number | null;
}

/** C32.1 `mrz`: raw lines (PII); parsing and check digits are TypeScript's. */
export interface MrzReadingInput {
  found: boolean;
  format_guess: 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB' | null;
  lines: readonly string[];
  line_confidences: readonly number[];
  box: VisionBoxInput | null;
}

/** A decoded barcode (PII): zxing-cpp's format name, the raw bytes and the plain text. */
export interface BarcodeInput {
  format: string;
  bytes_b64: string;
  text: string;
  quad: VisionQuadInput;
}

export interface PortraitClarityInput {
  face_width_px: number;
  sharpness: number;
  landmarks_score: number;
}

/** C32.1 raw forensic scores. */
export interface ForensicsInput {
  exif: { software: string | null; make: string | null; model: string | null; has_gps: boolean };
  jpeg: {
    quality_estimate: number | null;
    standard_tables: boolean | null;
    double_compression_score: number | null;
  } | null;
  ela_score: number;
  moire_score: number;
  screen_grid_score: number;
  chroma: { mean_saturation: number; colorfulness: number };
  color_cast_score: number;
  copy_move_score: number;
  portrait_boundary_score: number | null;
  star_glyph: { found: boolean; score: number; box: VisionBoxInput | null };
}

export interface IdSideAnalysisInput {
  quality: VisionQualityInput;
  faces: readonly VisionFaceInput[];
  /** The ID portrait; always `null` on the back. */
  portrait: VisionEmbeddedFaceInput | null;
  document?: DocumentDetectionInput | undefined;
  document_quality?: DocumentQualityInput | null | undefined;
  text?: readonly TextLineInput[] | undefined;
  mrz?: MrzReadingInput | undefined;
  barcodes?: readonly BarcodeInput[] | undefined;
  portrait_clarity?: PortraitClarityInput | null | undefined;
  forensics?: ForensicsInput | null | undefined;
  /** 16 lowercase hex characters, the DCT perceptual hash of the rectified document. */
  phash?: string | null | undefined;
}

/** `POST /v1/analyze/government-id`. */
export interface GovernmentIdAnalysisInput {
  model_versions?: Readonly<Record<string, string | null>> | undefined;
  sides: { front: IdSideAnalysisInput; back: IdSideAnalysisInput | null };
}

/** C41.1 `face_quality` of a selfie pose's primary (largest) face. */
export interface SelfieFaceQualityInput {
  box: VisionBoxInput;
  width_px: number;
  /** The face box height over the image height. */
  height_ratio: number;
  center_offset: readonly [dx: number, dy: number];
  /** Laplacian variance of the face region resized to 112 pixels wide. */
  blur_score: number;
  brightness: number;
  /** Saturated share of the face region without the eye regions. */
  glare_ratio: number;
}

/** C41.1 `head_pose`: decisions read `yaw_ratio` relative to the centre pose. */
export interface HeadPoseInput {
  /** `(x_nose - x_eye_mid) / inter-ocular distance`, de-rolled; positive is the user's left. */
  yaw_ratio: number;
  roll_deg: number;
  yaw_deg: number | null;
  pitch_deg: number | null;
  method: string;
}

/** C41.1 `passive_liveness`: P(real) per MiniFASNet model and their mean. */
export interface PassiveLivenessInput {
  v2: number;
  v1se: number;
  mean: number;
  effective_scales: { v2: number; v1se: number };
}

/** C41.1 `occlusion`: the covering and glasses heuristics' scores and components. */
export interface OcclusionInput {
  covering: {
    score: number;
    skin_fraction_ratio: number;
    texture_ratio: number;
    delta_e: number;
    forehead_valid: boolean;
  };
  glasses: {
    score: number;
    rim_edge_energy: number;
    lens_highlight_ratio: number;
    bridge_edge_density: number;
  };
}

/** C41.1 `synthetic`: weight-free synthetic-face cues, each `null` when not measured. */
export interface SyntheticScoresInput {
  spectral_tail_deviation: number | null;
  residual_peak_ratio: number | null;
  noise_inconsistency: number | null;
  jpeg_grid_misalignment: number | null;
  canonical_landmark_distance: number | null;
  /** XMP `DigitalSourceType` of an upload, else `null`. */
  digital_source_type: string | null;
}

/** C41.1 `background` of the centre pose (personal data: never copied into a result). */
export interface BackgroundLayoutInput {
  layout: readonly number[];
  valid_cells: string;
  /** The share of the 48 layout cells the person mask left visible. */
  coverage: number;
}

/** C41.1 `consistency`: how a side pose relates to the centre. */
export interface PoseConsistencyInput {
  pose: 'left' | 'right';
  face_cosine_to_center: number | null;
  planarity: {
    tracked_points: number;
    median_residual_ratio: number;
    p90_residual_ratio: number;
  } | null;
  registered_ssim: number | null;
  raw_ssim: number | null;
  /** `null` when not measured. */
  duplicate_of_center: boolean | null;
}

/**
 * One analysed selfie pose. The C41.1 fields are optional so that Phase 1 inputs still type;
 * absent or `null` means "not measured", never a default.
 */
export interface SelfiePoseAnalysisInput {
  quality: VisionQualityInput;
  faces: readonly VisionFaceInput[];
  /** The main face, or `null` when none was found. */
  face: VisionEmbeddedFaceInput | null;
  /** EXIF-upright size of the pose image. */
  image?: { width: number; height: number } | null | undefined;
  face_quality?: SelfieFaceQualityInput | null | undefined;
  head_pose?: HeadPoseInput | null | undefined;
  passive_liveness?: PassiveLivenessInput | null | undefined;
  occlusion?: OcclusionInput | null | undefined;
  synthetic?: SyntheticScoresInput | null | undefined;
  /** Centre only. */
  background?: BackgroundLayoutInput | null | undefined;
}

/** `POST /v1/analyze/selfie` (C6, C41.1). A side pose is absent or `null` when not uploaded. */
export interface SelfieAnalysisInput {
  poses: {
    center: SelfiePoseAnalysisInput;
    left?: SelfiePoseAnalysisInput | null | undefined;
    right?: SelfiePoseAnalysisInput | null | undefined;
  };
  /** One entry per side pose present (C41.1). */
  consistency?: readonly PoseConsistencyInput[] | undefined;
}

/** ID sides a government ID flow step asks for. */
export type IdSides = 'front' | 'back' | 'both';

/** An uploaded image, identified by the SHA-256 of its plaintext. */
export interface UploadedImage {
  sha256: string;
}

/** The ID portrait a selfie is compared with, and the verification it came from. */
export interface IdPortraitInput {
  embedding: readonly number[];
  verificationId: string;
}

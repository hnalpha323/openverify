/**
 * What the document and proof-of-address evaluators read (C60.1, C60.5, C60.6). The worker passes
 * vision's `/v1/analyze/document` measurements as they arrive (the snake_case members below are
 * that answer's, so a `DocumentAnalysis` is accepted as is), or the refusal vision answered
 * (`documentVisionRefusalOf` maps its status and code), the step's accepted classes, the
 * references the name and address are compared with, and the OCR models the analysis used.
 *
 * Text-layer and OCR lines are PII: the evaluators read them in memory and return only levels,
 * counts, flags and field names in results; the extracted values leave only through
 * `DocumentReading.fields`, for the sealed `document_extractions` row.
 */
import type { CheckModel, DocumentType } from '@openverify/core';
import type { PostalAddress } from '../matching/addresses.js';
import type { PersonName } from '../matching/names.js';

/** A supporting-document class (PLAN §4.3): utility bill, bank statement, lease, pay stub, tax. */
export type DocumentClass = DocumentType;

/** A class, or what the classifier answers when none is established (C60.5). */
export type DocumentClassification = DocumentClass | 'other' | 'unknown';

/** `[x, y, width, height]` in the page raster's pixels. */
export type DocumentBox = readonly [x: number, y: number, width: number, height: number];

/** Why vision marked a text-layer line invisible (C60.1). */
export type DocumentHiddenReason =
  'render_mode_invisible' | 'clipped' | 'off_page' | 'covered' | 'background_fill' | 'too_small';

/** One line of a PDF page's text layer, visible or not. PII. */
export interface DocumentTextLayerLineInput {
  readonly text: string;
  readonly box: DocumentBox;
  /** Indexes into `pdf.fonts`. */
  readonly font_ids: readonly number[];
  readonly font_size_pt: number | null;
  readonly visible: boolean;
  readonly hidden_reason: DocumentHiddenReason | null;
}

/** One OCR line of a page raster. PII. */
export interface DocumentOcrLineInput {
  readonly text: string;
  readonly confidence: number;
  readonly box: DocumentBox;
}

export interface DocumentPageInput {
  /** 1-based. */
  readonly number: number;
  /** The raster read, in pixels; every box is in it. */
  readonly width: number;
  readonly height: number;
  /** The PDF page box in points; `null` for a photo. */
  readonly width_pt: number | null;
  readonly height_pt: number | null;
  readonly text_layer: readonly DocumentTextLayerLineInput[];
  readonly ocr: readonly DocumentOcrLineInput[];
  /** `null` unless the page has both a text layer and OCR lines. */
  readonly text_layer_ocr_agreement: number | null;
}

export interface DocumentXmpInput {
  readonly creator_tool: string | null;
  readonly producer: string | null;
  readonly create_date: string | null;
  readonly modify_date: string | null;
  readonly metadata_date: string | null;
  readonly document_id: string | null;
  readonly instance_id: string | null;
  readonly history_agents: readonly string[];
}

export interface DocumentPdfFontInput {
  /** Its position in `pdf.fonts`. */
  readonly id: number;
  readonly base_name: string;
  readonly subset_tag: string | null;
  readonly embedded: boolean;
}

/** The dangerous actions only (a GoTo `/OpenAction` is not counted, C60.1). */
export interface DocumentPdfActionsInput {
  readonly javascript: number;
  readonly launch: number;
  readonly submit_form: number;
  readonly goto_remote: number;
  readonly rich_media: number;
  readonly embedded_files: number;
}

export interface DocumentPdfInput {
  readonly producer: string | null;
  readonly creator: string | null;
  /** ISO 8601. */
  readonly creation_date: string | null;
  readonly modification_date: string | null;
  readonly xmp: DocumentXmpInput | null;
  readonly linearized: boolean;
  /** Incremental-update sections, a linearized first-page section not counted. */
  readonly revisions: number;
  readonly xref_repaired: boolean;
  readonly eof_markers: number;
  readonly bytes_after_last_eof: number;
  readonly object_streams: number;
  readonly fonts: readonly DocumentPdfFontInput[];
  readonly annotations: number;
  readonly form_fields: number;
  readonly actions: DocumentPdfActionsInput;
  readonly signatures: number;
  /** Edits after a signature, DSS-only and DocTimeStamp-only increments excluded. */
  readonly edits_after_signature: boolean;
}

/** Image forensics (C60.1): `null` is "not measured". */
export interface DocumentImageInput {
  readonly exif_software: string | null;
  readonly exif_datetime_original: string | null;
  readonly exif_datetime: string | null;
  readonly jpeg_quality: number | null;
  readonly double_compression_score: number | null;
  readonly ela_text_cell_score: number | null;
  readonly copy_move_score: number | null;
}

/** vision's `/v1/analyze/document` answer (C60.1), as the evaluators read it. */
export interface DocumentAnalysisInput {
  readonly source: 'pdf' | 'image';
  readonly page_count: number;
  /** The first three pages and the last, 1-based. */
  readonly analysed_pages: readonly number[];
  readonly pages: readonly DocumentPageInput[];
  /** Set exactly for a PDF. */
  readonly pdf: DocumentPdfInput | null;
  readonly image: DocumentImageInput | null;
}

/**
 * Why vision refused the document (C60.1, C60.6): too large (413), more than 50 pages, a PDF that
 * needs a password, or anything else it could not read (415, 422 `pdf_unprocessable`).
 */
export type DocumentVisionRefusal =
  'too_large' | 'too_many_pages' | 'password_protected' | 'unreadable';

/** What vision said about the document, or that the call failed for good after its retries. */
export type DocumentVisionOutcome =
  | { readonly kind: 'analysis'; readonly analysis: DocumentAnalysisInput }
  | { readonly kind: 'refused'; readonly refusal: DocumentVisionRefusal }
  | { readonly kind: 'error' };

/** A name and address the document is compared with (C60.6). PII. */
export interface DocumentReference {
  readonly name?: PersonName | null | undefined;
  readonly address?: PostalAddress | null | undefined;
}

/**
 * C60.6: the references, in the order they are read: the inquiry's fields, else the inquiry's
 * latest government ID extraction, else the account. Each comparison takes the first that holds
 * its field.
 */
export interface DocumentReferences {
  readonly inquiry?: DocumentReference | null | undefined;
  readonly governmentId?: DocumentReference | null | undefined;
  readonly account?: DocumentReference | null | undefined;
}

/** The OCR models vision ran, pinned by SHA-256 (C29.2 provenance), as the worker knows them. */
export interface DocumentModels {
  readonly textDetector?: CheckModel | undefined;
  readonly textRecognizer?: CheckModel | undefined;
}

export interface DocumentCheckInput {
  /** vision's answer; `null` when the document was never analysed (no file). */
  readonly vision: DocumentVisionOutcome | null;
  /** The step's `documentTypes` (C50.3): the classes it accepts. */
  readonly acceptedTypes: readonly DocumentClass[];
  readonly references?: DocumentReferences | undefined;
  readonly models?: DocumentModels | undefined;
  /** The evaluation instant (today for recency and expiry); now by default. */
  readonly now?: Date | undefined;
}

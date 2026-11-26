/**
 * The evaluator of every government ID check of PLAN §4.1 (C29): a function of the shared
 * evaluation context. The seven Phase 1 and pre-Phase 3 functions keep their narrow inputs; the
 * adapters here feed them from the context (C29.6). `id_nfc_expired_detection` belongs to the NFC
 * verification and is logic only until Phase 5 (`idNfcExpiredDetection`).
 */
import type { CheckId, CheckResult } from '@openverify/core';
import { idAgeComparison } from '../id-age-comparison.js';
import { idDisallowedCountryDetection } from '../id-disallowed-country-detection.js';
import { idDisallowedTypeDetection } from '../id-disallowed-type-detection.js';
import { idExpiredDetection } from '../id-expired-detection.js';
import { idMrzInconsistencyDetection, type VizFields } from '../id-mrz-inconsistency-detection.js';
import { idPoBoxDetection } from '../id-po-box-detection.js';
import { idValidDatesDetection } from '../id-valid-dates-detection.js';
import {
  idBlurDetection,
  idDoubleSideDetection,
  idGlareDetection,
  idPortraitDetection,
} from '../phase1/government-id-checks.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { idAamvaDatabaseLookup } from './id-aamva-database-lookup.js';
import { idAccountComparison } from './id-account-comparison.js';
import { idAgeInconsistencyDetection } from './id-age-inconsistency-detection.js';
import { idBarcodeDetection } from './id-barcode-detection.js';
import { idBarcodeInconsistencyDetection } from './id-barcode-inconsistency-detection.js';
import { idColorInconsistencyDetection } from './id-color-inconsistency-detection.js';
import { idCompromisedDetection } from './id-compromised-detection.js';
import { idElectronicReplicaDetection } from './id-electronic-replica-detection.js';
import { idEntityDetection } from './id-entity-detection.js';
import { idExtractedPropertiesDetection } from './id-extracted-properties-detection.js';
import { idExtractionInconsistencyDetection } from './id-extraction-inconsistency-detection.js';
import { idFabricationDetection } from './id-fabrication-detection.js';
import { idHandwritingDetection } from './id-handwriting-detection.js';
import { idInconsistentRepeatDetection } from './id-inconsistent-repeat-detection.js';
import { idInquiryComparison } from './id-inquiry-comparison.js';
import { idMrzDetection } from './id-mrz-detection.js';
import { idNumberFormatInconsistencyDetection } from './id-number-format-inconsistency-detection.js';
import { idPortraitClarityDetection } from './id-portrait-clarity-detection.js';
import { idPublicFigureDetection } from './id-public-figure-detection.js';
import { idRealIdDetection } from './id-real-id-detection.js';
import { idRepeatDetection } from './id-repeat-detection.js';
import { idSelfieComparison } from './id-selfie-comparison.js';
import { idTamperDetection } from './id-tamper-detection.js';
import { idUnprocessableSubmissionDetection } from './id-unprocessable-submission-detection.js';
import { numberOf, sideNotRequested } from './values.js';

export type GovernmentIdEvaluator = (context: GovernmentIdContext) => CheckResult;

const fieldsOf = (context: GovernmentIdContext) => context.extraction.consolidated.fields;

/** The MRZ lines as read, from the side the extraction found them on. */
function mrzLines(context: GovernmentIdContext): readonly string[] {
  const { mrz, mrzError } = context.extraction.sources;
  const side = mrz?.side ?? mrzError?.side;
  const { front, back } = context.input.analysis.sides;
  const entry = side === 'front' ? front : side === 'back' ? back : null;
  return entry?.mrz?.lines ?? [];
}

/** The visual-zone fields in the MRZ check's terms. */
function vizFields(context: GovernmentIdContext): VizFields {
  const fields = context.extraction.sources.viz?.fields ?? {};
  return {
    documentNumber: fields['identification-number'],
    surname: fields['name-last'],
    givenNames: fields['name-first'],
    birthDate: fields.birthdate,
    expirationDate: fields['expiration-date'],
    sex: fields.sex,
    nationality: fields.nationality,
    issuingState: fields['issuing-authority-code'],
  };
}

function idMrzInconsistency(context: GovernmentIdContext): CheckResult {
  const { features } = context;
  const { analysis, requiredSides } = context.input;
  return idMrzInconsistencyDetection({
    mrz: mrzLines(context),
    viz: vizFields(context),
    features,
    mrzNotRequested:
      features?.mrz === true && sideNotRequested(analysis, requiredSides, features.mrzSide),
  });
}

function idDisallowedCountry(context: GovernmentIdContext): CheckResult {
  const issuer = context.extraction.document.issuer;
  const allowed = context.template['allowed-countries'] ?? context.input.step?.allowedCountries;
  return idDisallowedCountryDetection(
    {
      issuingCountry:
        issuer === null ? null : issuer.scheme === 'icao' ? issuer.code : issuer.country,
      established: issuer !== null,
    },
    allowed === undefined ? {} : { allowedCountries: [...allowed] },
  );
}

function idDisallowedType(context: GovernmentIdContext): CheckResult {
  const { idClass } = context.extraction.document;
  const allowed = context.template['allowed-id-classes'] ?? context.input.step?.allowedIdClasses;
  return idDisallowedTypeDetection(
    { idClass, established: idClass !== null },
    allowed === undefined ? {} : { allowedIdClasses: [...allowed] },
  );
}

function idPoBox(context: GovernmentIdContext): CheckResult {
  const fields = fieldsOf(context);
  const locality = [
    fields['address-city'],
    fields['address-subdivision'],
    fields['address-postal-code'],
  ]
    .filter((part) => part !== null)
    .join(' ');
  return idPoBoxDetection({
    address: [fields['address-street-1'], fields['address-street-2'], locality].filter(
      (line): line is string => line !== null && line !== '',
    ),
  });
}

/** Every government ID check of §4.1, by id. */
export const GOVERNMENT_ID_EVALUATORS = Object.freeze({
  id_unprocessable_submission_detection: idUnprocessableSubmissionDetection,
  id_blur_detection: (context) =>
    idBlurDetection(context.input.analysis, checkConfigOf(context, 'id_blur_detection')),
  id_glare_detection: (context) =>
    idGlareDetection(context.input.analysis, checkConfigOf(context, 'id_glare_detection')),
  id_double_side_detection: (context) =>
    idDoubleSideDetection({
      requiredSides: context.input.requiredSides,
      uploads: context.input.uploads,
      analysis: context.input.analysis,
      features: context.features,
      config: checkConfigOf(context, 'id_double_side_detection'),
    }),
  id_portrait_detection: (context) =>
    idPortraitDetection(context.input.analysis, modelsOf(context, ['faceDetector'])),
  id_portrait_clarity_detection: idPortraitClarityDetection,
  id_mrz_detection: idMrzDetection,
  id_mrz_inconsistency_detection: idMrzInconsistency,
  id_barcode_detection: idBarcodeDetection,
  id_barcode_inconsistency_detection: idBarcodeInconsistencyDetection,
  id_extracted_properties_detection: idExtractedPropertiesDetection,
  id_extraction_inconsistency_detection: idExtractionInconsistencyDetection,
  id_number_format_inconsistency_detection: idNumberFormatInconsistencyDetection,
  id_expired_detection: (context) =>
    idExpiredDetection(
      { expirationDate: fieldsOf(context)['expiration-date'], features: context.features },
      {
        graceDays: numberOf(checkConfigOf(context, 'id_expired_detection'), 'grace-days'),
        now: context.now,
      },
    ),
  id_valid_dates_detection: (context) => {
    const fields = fieldsOf(context);
    return idValidDatesDetection(
      {
        birthDate: fields.birthdate,
        issueDate: fields['issue-date'],
        expirationDate: fields['expiration-date'],
      },
      {
        maxValidityYears: numberOf(
          checkConfigOf(context, 'id_valid_dates_detection'),
          'max-validity-years',
        ),
        now: context.now,
      },
    );
  },
  id_age_comparison: (context) => {
    const config = checkConfigOf(context, 'id_age_comparison');
    return idAgeComparison(
      { birthDate: fieldsOf(context).birthdate },
      {
        minAge: numberOf(config, 'min-age'),
        maxAge: numberOf(config, 'max-age'),
        now: context.now,
      },
    );
  },
  id_age_inconsistency_detection: idAgeInconsistencyDetection,
  id_disallowed_country_detection: idDisallowedCountry,
  id_disallowed_type_detection: idDisallowedType,
  id_po_box_detection: idPoBox,
  id_real_id_detection: idRealIdDetection,
  id_color_inconsistency_detection: idColorInconsistencyDetection,
  id_electronic_replica_detection: idElectronicReplicaDetection,
  id_tamper_detection: idTamperDetection,
  id_fabrication_detection: idFabricationDetection,
  id_handwriting_detection: idHandwritingDetection,
  id_compromised_detection: idCompromisedDetection,
  id_entity_detection: idEntityDetection,
  id_repeat_detection: idRepeatDetection,
  id_inconsistent_repeat_detection: idInconsistentRepeatDetection,
  id_account_comparison: idAccountComparison,
  id_inquiry_comparison: idInquiryComparison,
  id_selfie_comparison: idSelfieComparison,
  id_public_figure_detection: idPublicFigureDetection,
  id_aamva_database_lookup: idAamvaDatabaseLookup,
} as const satisfies Readonly<Partial<Record<CheckId, GovernmentIdEvaluator>>>);

/** The checks `GOVERNMENT_ID_EVALUATORS` evaluates: every `government_id` check of the registry. */
export const GOVERNMENT_ID_EVALUATED_CHECKS: readonly CheckId[] = Object.freeze(
  Object.keys(GOVERNMENT_ID_EVALUATORS) as CheckId[],
);

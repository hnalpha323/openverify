/**
 * `document_extracted_properties_detection` (R, model-based, user behaviour, required; C60.6): each
 * property `required-properties` names (name, address, issue date, issuer) was read from the
 * document's visible text; fails with one `*_not_found` reason per missing property. A tax
 * document's printed tax year is its issue date; a labelled issue date counts as found even when
 * it is ambiguous or printed twice (recency then answers `input_missing`).
 */
import { DOCUMENT_PROPERTIES, type CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions, stringListIn } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import { documentOcrModels, type DocumentContext } from './context.js';
import type { DocumentExtraction } from './extract.js';

const ID = 'document_extracted_properties_detection';

type DocumentProperty = (typeof DOCUMENT_PROPERTIES)[number];

const NOT_FOUND: Readonly<Record<DocumentProperty, string>> = {
  name: 'name_not_found',
  address: 'address_not_found',
  'issue-date': 'issue_date_not_found',
  issuer: 'issuer_not_found',
};

function found(property: DocumentProperty, extraction: DocumentExtraction): boolean {
  switch (property) {
    case 'name':
      return extraction.name !== null;
    case 'address':
      return extraction.address !== null;
    case 'issue-date':
      return extraction.issueDateFound;
    case 'issuer':
      return extraction.issuer !== null;
  }
}

export function documentExtractedPropertiesDetection(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const models = documentOcrModels(context);
  const options = phase5ResultOptions(
    config,
    ['required-properties'],
    models === undefined ? {} : { models },
  );
  const { extraction } = context;
  if (context.established === null || extraction === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const configured = stringListIn(config, 'required-properties');
  const required = DOCUMENT_PROPERTIES.filter((property) => configured.includes(property));
  const missing = required.filter((property) => !found(property, extraction));
  const metadata = { 'required-properties': required, missing };
  return missing.length === 0
    ? checkResult(ID, 'passed', [], metadata, options)
    : checkResult(
        ID,
        'failed',
        missing.map((property) => NOT_FOUND[property]),
        metadata,
        options,
      );
}

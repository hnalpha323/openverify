/**
 * C100.2 (decision 31): the encodings an import is decoded with, which live with the shared CSV
 * reader (`packages/checks/src/csv/read.ts`, F13). Owner: `api-importers`.
 */
export {
  decodeCsv as decodeImportFile,
  resolveCsvEncoding as resolveImportEncoding,
} from '@openverify/checks';

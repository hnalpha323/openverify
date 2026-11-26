import type { Linter } from 'eslint';

export declare const PHASE5_FOLDERS: readonly string[];
export declare const WORKFLOW_7A_NETWORK_FOLDERS: readonly string[];
export declare const REDACTED_PERSONAL_LOG_KEYS: readonly string[];
export declare const REFUSED_LOG_KEY_PATTERN: string;
export declare const CONNECT_CROSS_TENANT_MODULE: string;
export declare const CONNECT_CROSS_TENANT_IMPORT_PATTERNS: readonly string[];
export declare function phase5Config(): Linter.Config[];

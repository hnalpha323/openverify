import type { Linter } from 'eslint';

/** A rule of eslint-plugin-security with its state and why (C260.1). */
export interface SecurityRule {
  readonly state: 'error' | 'off';
  readonly reason: string;
}

export declare const SECURITY_RULES: Readonly<Record<string, SecurityRule>>;
export declare const NON_LITERAL_FS_FILENAME_FOLDERS: readonly string[];
export declare const SECURITY_SUPPRESSION_CEILING: Readonly<Record<string, number>>;
export declare function securityConfig(): Linter.Config[];

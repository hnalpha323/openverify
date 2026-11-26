export interface OperatorPatternSelector {
  readonly selector: string;
  readonly message: string;
}

export interface RegexpExemptFileGroup {
  readonly globs: readonly string[];
  readonly reason: string;
}

export interface ReviewedRegexpCallSite {
  readonly file: string;
  readonly sites: number;
  readonly reason: string;
}

export declare const OPERATOR_PATTERN_SELECTORS: readonly OperatorPatternSelector[];
export declare const REGEXP_EXEMPT_FILE_GROUPS: readonly RegexpExemptFileGroup[];
export declare const REVIEWED_REGEXP_CALL_SITES: readonly ReviewedRegexpCallSite[];
export declare function regexpAllowlistGlobs(): string[];
export declare const OPERATOR_PATTERN_MESSAGE: string;

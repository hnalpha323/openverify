import type { ESLint, Linter } from 'eslint';

export declare const LOGICAL_PROPERTIES_FILES: readonly string[];
export declare const logicalPropertiesPlugin: ESLint.Plugin;
export declare function logicalPropertiesConfig(): Linter.Config[];

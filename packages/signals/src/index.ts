/**
 * `@openverify/signals` (plan C94.1): the package entry. Its three areas have their own entries,
 * so the flow bundles only the collector and the API only the network lookups:
 * - `@openverify/signals/browser` (C94.3, C94.4, `client-collector`);
 * - `@openverify/signals/network` (C92.3, C93.3, C93.4, `network-data`);
 * - `@openverify/signals/testing` (synthetic publisher files and the MMDB writer, `network-data`).
 */
export const PACKAGE_NAME = '@openverify/signals';

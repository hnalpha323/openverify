/**
 * The sample customer site in the e2e stack (C266.3; sdk-web-11c's apps/demo-web). The stack builds
 * it on every start, in both modes, into the run's artifacts (never `apps/demo-web/dist`, which its
 * own spec builds). It is not started: running it needs a webhook registered on the seeded sandbox,
 * which every other spec's webhook listing would then show, and no full-stack spec uses it (its own
 * Playwright spec runs against a stand-in installation, `pnpm --filter @openverify/demo-web e2e`).
 */
export function demoWebBuildArgs(outDir: string): string[] {
  return ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'];
}

/**
 * CPU time of a run, in milliseconds (the same measure as `@openverify/checks`' document testing
 * `cpuMilliseconds`, which this package cannot import): a CPU budget in a unit test is measured
 * in CPU time, which other processes on a loaded machine do not add to, never on the wall clock.
 */
export function cpuMilliseconds(run: () => void): number {
  const before = process.cpuUsage();
  run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

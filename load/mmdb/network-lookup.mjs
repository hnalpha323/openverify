// Workflow 7A's item (b) (Workflow 11D load-harness; the load method's `network-lookup` row, C93.2):
// writes the default sources' synthetic files at the sizes the research measured into an empty
// directory (`writeMemoryFiles`; `--scale` shrinks them, for the tests), loads each as a sync would,
// and times `--calls` evaluations (1,000,000 by default) of documentation addresses, one JSON line.
//
// From the repository root:
//   node --experimental-transform-types --no-warnings --conditions=@openverify/source \
//     --import ./packages/checks/scripts/register-ts.mjs load/mmdb/network-lookup.mjs <empty dir> \
//     [--calls 1000000] [--scale 1]
import { readFileSync, readdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { writeMemoryFiles } from '../../packages/signals/src/testing/memory-measurement.ts';
import {
  NETWORK_LOOKUP_CALLS,
  lookupSources,
  timeLookups,
} from '../../apps/api/scripts/network-benchmark.ts';

const args = process.argv.slice(2);
const directory = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : Number(args[index + 1]);
};
if (directory === undefined || readdirSync(directory).length > 0) {
  process.stderr.write('usage: network-lookup.mjs <empty dir> [--calls n] [--scale s]\n');
  process.exit(2);
}
const files = writeMemoryFiles(directory, option('--scale', 1));
const paths = {
  'dbip-country-lite': files.mmdb.country,
  'dbip-asn-lite': files.mmdb.asn,
  'tor-exit-addresses': files.tor,
  ...files.ranges,
};
const loadStart = loadavg()[0];
const timing = timeLookups(
  lookupSources((sourceId) => readFileSync(paths[sourceId])),
  { calls: option('--calls', NETWORK_LOOKUP_CALLS) },
);
process.stdout.write(`${JSON.stringify({ ...timing, loadStart, loadEnd: loadavg()[0] })}\n`);

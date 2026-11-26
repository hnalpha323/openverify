/**
 * C62.9: the self-test runs before any emrtd test. Explicit-parameter brainpool keys are what
 * real passports carry (Doc 9303-12 §4.1.6.3); a Node whose OpenSSL cannot verify them would make
 * every chip test meaningless, so the suite stops here and names the platform instead.
 */
import { selfTest } from './src/self-test.js';

export default function setup(): void {
  const result = selfTest();
  if (!result.ok) {
    throw new Error(
      `emrtd self-test failed on Node ${result.node} (OpenSSL ${result.openssl}): ${result.failures.join(', ')}`,
    );
  }
}

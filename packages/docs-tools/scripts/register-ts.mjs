/**
 * Lets Node run TypeScript sources directly (Node >= 22.18 strips the types; the package scripts
 * pass --experimental-transform-types): this package's sources and the repository modules a
 * generator reads import each other as `./file.js`, as a build emits them, so a relative `.js`
 * import that does not exist resolves to its `.ts` source. Used with `--import` by the package
 * scripts (a copy of packages/checks/scripts/register-ts.mjs; no dependency is added for it).
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('/'))) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

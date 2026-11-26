/**
 * Lets Node run this package's TypeScript sources directly (Node >= 22.18 strips the types): the
 * sources import each other as `./file.js`, as the build emits them, so a relative `.js` import
 * that does not exist resolves to its `.ts` source. Used with `--import` by the package scripts.
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

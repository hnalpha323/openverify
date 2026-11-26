/**
 * Helpers for testing Fastify plugins in isolation. Only tests import this folder.
 */
import Fastify, { type FastifyPluginOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type FastifyPluginAsyncZod,
  type FastifyPluginCallbackZod,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

/** The routes `plugin` registers on a bare app, as `METHOD url`, in registration order. */
export async function routesOf<O extends FastifyPluginOptions>(
  plugin: FastifyPluginCallbackZod<O> | FastifyPluginAsyncZod<O>,
  options: O,
): Promise<string[]> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const routes: string[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    routes.push(...methods.map((method) => `${method} ${route.url}`));
  });
  await app.register(plugin, options);
  await app.ready();
  await app.close();
  return routes;
}

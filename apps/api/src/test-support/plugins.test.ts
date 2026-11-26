import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { routesOf } from './plugins.js';

describe('routesOf', () => {
  it('lists every route a plugin registers, so an empty list really means none', async () => {
    const plugin: FastifyPluginCallbackZod<{ path: string }> = (app, options, done) => {
      app.get(options.path, () => ({ ok: true }));
      app.route({
        method: ['POST', 'PATCH'],
        url: `${options.path}/:id`,
        schema: { params: z.object({ id: z.string() }) },
        handler: () => ({ ok: true }),
      });
      done();
    };

    expect(await routesOf(plugin, { path: '/things' })).toEqual([
      'GET /things',
      'HEAD /things',
      'POST /things/:id',
      'PATCH /things/:id',
    ]);
  });
});

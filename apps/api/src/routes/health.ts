import { HealthResponse } from '@copilot/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

export function providerStatus(config: Config): HealthResponse['provider'] {
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      return { name: 'anthropic', model: config.ANTHROPIC_MODEL, configured: Boolean(config.ANTHROPIC_API_KEY) };
    case 'nebius':
      return {
        name: 'nebius',
        model: config.NEBIUS_MODEL,
        configured: Boolean(config.NEBIUS_API_KEY),
      };
    case 'fake':
      return { name: 'fake', model: 'fake', configured: true };
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const { db, config } = app.deps;
    let dbStatus: HealthResponse['db'];
    try {
      await db.execute(sql`select 1`);
      dbStatus = { ok: true };
    } catch (err) {
      dbStatus = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const provider = providerStatus(config);
    const offered = config.LLM_PROVIDER === 'fake' ? (['fake', 'anthropic', 'nebius'] as const) : (['anthropic', 'nebius'] as const);
    const body = HealthResponse.parse({
      // A missing key is not "degraded": users can supply one in the UI.
      status: dbStatus.ok ? 'ok' : 'degraded',
      db: dbStatus,
      provider,
      providers: offered.map((name) => {
        const p = providerStatus({ ...config, LLM_PROVIDER: name });
        return { name, model: p.model, serverKey: p.configured };
      }),
    });
    return reply.status(dbStatus.ok ? 200 : 503).send(body);
  });
}

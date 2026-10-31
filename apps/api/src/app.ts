import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { errorBody, HttpError } from './lib/errors.js';
import type { ProviderName } from '@copilot/shared';
import { EventBus } from './agent/events.js';
import { createProvider } from './llm/registry.js';
import type { LLMProvider } from './llm/provider.js';
import { campaignRoutes } from './routes/campaigns.js';
import { runRoutes } from './routes/runs.js';
import { healthRoutes } from './routes/health.js';
import { attributionMockPlugin, type AttributionMockOptions } from './sources/attributionMock/plugin.js';
import type { FraudStore } from './sources/fraudCsv/loader.js';

export interface AppDeps {
  config: Config;
  db: Db;
  fraud: FraudStore;
  events: EventBus;
  /** Tests swap in a FakeProvider; production uses the registry. */
  providerFactory: (name: ProviderName, userKey?: string) => LLMProvider;
}

export function defaultDeps(base: Pick<AppDeps, 'config' | 'db' | 'fraud'>): AppDeps {
  return { ...base, events: new EventBus(), providerFactory: (name, userKey) => createProvider(name, base.config, userKey) };
}

export interface BuildAppOptions {
  logger?: boolean;
  /** Tests override the mock's randomness to force or suppress injected faults. */
  attributionRandom?: AttributionMockOptions['random'];
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/** Builds the app without listening, so tests can drive it with `inject`. */
export function buildApp(deps: AppDeps, opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  app.decorate('deps', deps);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(errorBody('validation_error', 'Request validation failed', err.issues));
    }
    // Fastify's own errors (bad JSON body, payload too large) carry a 4xx statusCode.
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send(errorBody('bad_request', err instanceof Error ? err.message : 'Bad request'));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(errorBody('internal_error', 'Internal server error'));
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send(errorBody('not_found', `Route ${req.method} ${req.url} not found`)),
  );

  app.register(healthRoutes);
  app.register(campaignRoutes);
  app.register(runRoutes);
  app.register(attributionMockPlugin, {
    prefix: '/mock/attribution',
    dataDir: deps.config.DATA_DIR,
    failureRate: deps.config.ATTRIBUTION_FAILURE_RATE,
    latencyMsMin: deps.config.ATTRIBUTION_LATENCY_MS_MIN,
    latencyMsMax: deps.config.ATTRIBUTION_LATENCY_MS_MAX,
    ...(opts.attributionRandom ? { random: opts.attributionRandom } : {}),
  });
  return app;
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorBody } from '../../lib/errors.js';

export const ATTRIBUTION_FILE = 'attribution_stats.json';

/**
 * Stand-in for an external attribution provider (AppsFlyer/Adjust style). It lives in the
 * same process for convenience but is only ever reached over HTTP, owns its own data file
 * and uses its own campaign ids and snake_case payloads, like a real vendor would.
 */

const StatRow = z.object({
  date: z.string(),
  installs: z.number().int(),
  d1_retention: z.number(),
  d7_retention: z.number(),
  purchase_events: z.number().int(),
});
const AttributionFile = z.object({ campaigns: z.record(z.string(), z.array(StatRow)) });

const StatsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export interface AttributionMockOptions {
  dataDir: string;
  failureRate: number;
  latencyMsMin: number;
  latencyMsMax: number;
  /** Injectable so tests can force or suppress faults deterministically. */
  random?: () => number;
}

export async function attributionMockPlugin(app: FastifyInstance, opts: AttributionMockOptions) {
  const random = opts.random ?? Math.random;
  const file = path.join(opts.dataDir, ATTRIBUTION_FILE);
  let data: z.infer<typeof AttributionFile> | undefined;
  const load = async () => {
    data ??= AttributionFile.parse(JSON.parse(await readFile(file, 'utf8')));
    return data;
  };

  app.get<{ Params: { attributionId: string } }>('/campaigns/:attributionId/stats', async (req, reply) => {
    const latency = opts.latencyMsMin + random() * (opts.latencyMsMax - opts.latencyMsMin);
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));

    if (random() < opts.failureRate) {
      return reply
        .status(503)
        .header('retry-after', '1')
        .send(errorBody('service_unavailable', 'Attribution provider temporarily unavailable'));
    }

    const query = StatsQuery.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send(errorBody('validation_error', 'from and to are required (YYYY-MM-DD)', query.error.issues));
    }

    let stats;
    try {
      stats = (await load()).campaigns[req.params.attributionId];
    } catch (err) {
      req.log.error({ err }, 'attribution data file unreadable');
      return reply.status(500).send(errorBody('internal_error', 'Attribution data unavailable; run pnpm db:seed'));
    }
    if (!stats) {
      return reply.status(404).send(errorBody('not_found', `Unknown attribution campaign ${req.params.attributionId}`));
    }

    const { from, to } = query.data;
    return {
      campaign_id: req.params.attributionId,
      from,
      to,
      stats: stats.filter((s) => s.date >= from && s.date <= to),
    };
  });
}

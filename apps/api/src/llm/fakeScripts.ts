import { LAST_7, PREV_7 } from '../db/seed/scenarios.js';
import { fakeFinalTurn, fakeToolCall, type FakeScriptEntry } from './fake.js';

/**
 * Script used when LLM_PROVIDER=fake (E2E tests, offline demos). It answers every question
 * with the S1 investigation; numbers match the deterministic seed so the grounding check passes.
 * Small delays let the UI show steps streaming in.
 */
export function demoScript(): FakeScriptEntry[] {
  return [
    {
      delayMs: 300,
      stopReason: 'tool_use',
      toolCalls: [
        fakeToolCall('compare_campaign_periods', { before: PREV_7, after: LAST_7, sortBy: 'roas', limit: 3 }, 'demo_compare'),
      ],
    },
    {
      delayMs: 300,
      stopReason: 'tool_use',
      toolCalls: [fakeToolCall('get_fraud_signals', { campaignIds: ['cmp_007', 'cmp_012'], period: LAST_7 }, 'demo_fraud')],
    },
    {
      delayMs: 300,
      ...fakeFinalTurn({
        summary:
          'Two campaigns lost about half their ROAS last week. Tile Tide US (cmp_007) is driven by fraud: the vendor flags ~30% of installs and a 5 s median click-to-install time, a click-injection pattern. Cartly FR (cmp_012) doubled spend without matching install growth.',
        findings: [
          {
            campaignId: 'cmp_007',
            campaignName: 'Tile Tide | US | Android',
            metric: 'roas',
            before: 0.9318,
            after: 0.4738,
            changePct: -49.2,
            likelyCause: 'Click injection fraud: ~30% suspicious installs, median CTIT 5.3 s, flagged sub-publishers sp_4471 and sp_9020.',
            evidence: ['step_2', 'step_4'],
          },
          {
            campaignId: 'cmp_012',
            campaignName: 'Cartly | FR | iOS',
            metric: 'roas',
            before: 1.2733,
            after: 0.6784,
            changePct: -46.7,
            likelyCause: 'Spend roughly doubled while installs grew ~11%, so CPI rose sharply: likely a bid increase that bought no extra scale.',
            evidence: ['step_2'],
          },
        ],
        caveats: ['Demo run produced by the FakeProvider script.'],
        confidence: 'high',
      }),
    },
  ];
}

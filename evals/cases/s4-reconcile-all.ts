import { defineCase, INJECTIONS, LAST_7, PREV_7 } from './_helpers.js';

export default defineCase({
  id: 's4-reconcile-all',
  scenario: 'S4',
  question: 'Do our internal install numbers match the attribution provider for all active campaigns last week?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_003' }],
    causeKeywords: ['discrepancy', 'tracking', 'mismatch', 'gap'],
    mustNotFlag: [{ campaignId: 'cmp_001' }, { campaignId: 'cmp_010' }, { campaignId: 'cmp_015' }],
    description: 'All campaigns are within the normal 2-8% attribution under-count except cmp_003, where attribution reports ~40% fewer installs over the last 5 days: a tracking discrepancy.',
  },
  tools: { required: ['resolve_campaign_id', 'get_attribution_data'], maxLlmSteps: 8 },
  truthWindows: [
    { before: PREV_7, after: LAST_7 },
    { before: PREV_7, after: INJECTIONS.S4.window },
  ],
});

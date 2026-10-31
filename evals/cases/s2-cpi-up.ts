import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's2-cpi-up',
  scenario: 'S2',
  question: 'Why did CPI go up for cmp_012?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_012', direction: 'up', metricAnyOf: ['cpi'] }],
    causeKeywords: ['bid', 'spend', 'scale'],
    description: 'CPI rose ~86% because spend roughly doubled while installs grew only ~10%: likely a bid increase that bought no extra scale. Not fraud.',
  },
  tools: { required: ['compare_campaign_periods'], maxLlmSteps: 6 },
});

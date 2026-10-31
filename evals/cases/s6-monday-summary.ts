import { defineCase, HEALTHY_CONTROL_IDS, notFlagged } from './_helpers.js';

export default defineCase({
  id: 's6-monday-summary',
  scenario: 'S6',
  question: 'Give me a short Monday summary of anything unusual in the last 7 days.',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_007' }, { campaignId: 'cmp_012' }],
    causeKeywords: ['fraud', 'click injection', 'suspicious'],
    mustNotFlag: [...notFlagged(HEALTHY_CONTROL_IDS), { campaignId: 'cmp_021', unlessMentions: 'paused' }],
    description: 'Unusual: cmp_007 (fraud-driven ROAS drop), cmp_012 (spend doubled, CPI up); optionally cmp_018 (retention) and cmp_003 (attribution gap), cmp_021 paused. Healthy campaigns must not be flagged.',
  },
  tools: { required: ['compare_campaign_periods'], maxLlmSteps: 8 },
});

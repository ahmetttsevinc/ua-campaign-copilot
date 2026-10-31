import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's1-revenue-by-name',
  scenario: 'S1',
  question: 'Why did revenue fall for Tile Tide in the US last week?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_007', direction: 'down' }],
    causeKeywords: ['fraud', 'click injection', 'suspicious'],
    mustNotFlag: [{ campaignId: 'cmp_008' }, { campaignId: 'cmp_009' }],
    description: 'The user names the campaign, not the id: the agent must find cmp_007 (Tile Tide US Android) and explain the revenue drop as fraud.',
  },
  tools: { required: ['get_fraud_signals'], maxLlmSteps: 7 },
});

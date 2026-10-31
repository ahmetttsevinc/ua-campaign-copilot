import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's1-fraud-direct',
  scenario: 'S1',
  question: 'Is cmp_007 performing worse because of fraud?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_007', direction: 'down' }],
    causeKeywords: ['click injection', 'ctit', 'suspicious'],
    description: 'Yes: ROAS fell ~49% with stable installs; fraud vendor shows ~30% suspicious installs and median CTIT ~5 s (click injection) with flagged sub-publishers.',
  },
  tools: { required: ['get_fraud_signals'], maxLlmSteps: 6 },
});

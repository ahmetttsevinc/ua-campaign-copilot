import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's2-spend-change',
  scenario: 'S2',
  question: 'Which campaign increased its spend the most last week compared to the week before, and did it pay off?',
  expected: {
    // "Did it pay off?" is legitimately answered with ROAS, CPI or spend, so no metric/direction is pinned.
    findCampaigns: [{ campaignId: 'cmp_012' }],
    causeKeywords: ['spend'],
    description: 'cmp_012 spend roughly doubled (+105%) but installs rose only ~11% and ROAS fell ~47%: it did not pay off.',
  },
  tools: { required: ['compare_campaign_periods'], maxLlmSteps: 6 },
});

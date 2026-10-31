import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's3-quality-direct',
  scenario: 'S3',
  question: 'Is the user quality of cmp_018 getting worse?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_018', direction: 'down' }],
    causeKeywords: ['retention', 'd7'],
    description: 'Yes: D7 retention roughly halved last week versus the week before while install volume held.',
  },
  tools: { required: ['resolve_campaign_id', 'get_attribution_data'], maxLlmSteps: 6 },
});

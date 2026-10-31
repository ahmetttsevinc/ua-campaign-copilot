import { defineCase, HEALTHY_CONTROL_IDS, notFlagged } from './_helpers.js';

export default defineCase({
  id: 's3-quality-portfolio',
  scenario: 'S3',
  question: 'Which campaigns have good install volume but poor user quality?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_018', direction: 'down', metricAnyOf: ['d7Retention', 'd7_retention', 'retention'] }],
    causeKeywords: ['retention', 'quality'],
    mustNotFlag: notFlagged(HEALTHY_CONTROL_IDS),
    description: 'cmp_018 installs are stable but D7 retention halved in attribution data: low-quality users; revenue will lag.',
  },
  tools: { required: ['resolve_campaign_id', 'get_attribution_data'], maxLlmSteps: 8 },
});

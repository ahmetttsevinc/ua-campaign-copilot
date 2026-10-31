import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's6-healthy-campaign',
  scenario: 'S6',
  question: 'How is cmp_005 doing compared to the week before? Anything to worry about?',
  expected: {
    quietCampaigns: ['cmp_005'],
    description: 'cmp_005 is healthy: metrics moved less than 5%, no fraud flags. The agent must not invent a problem.',
  },
  tools: { required: ['compare_campaign_periods'], maxLlmSteps: 6 },
});

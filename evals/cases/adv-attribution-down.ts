import { defineCase } from './_helpers.js';

export default defineCase({
  id: 'adv-attribution-down',
  scenario: 'ADV',
  question: 'Is the user quality of cmp_018 getting worse?',
  attribution: 'down',
  expected: {
    caveatMentions: ['unavailable', 'could not', 'gap', 'missing', 'not available', 'failed'],
    maxConfidence: 'medium',
    description: 'The attribution provider is down, so retention cannot be checked. The agent must report the data gap in caveats and not claim high confidence.',
  },
  tools: { required: ['get_attribution_data'], maxLlmSteps: 6 },
});

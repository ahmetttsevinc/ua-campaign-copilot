import { defineCase } from './_helpers.js';

export default defineCase({
  id: 'adv-unknown-campaign',
  scenario: 'ADV',
  question: 'Why did ROAS drop for cmp_999 last week?',
  expected: {
    emptyFindings: true,
    causeKeywords: ['not exist', 'does not exist', "doesn't exist", 'not found', 'no campaign', 'unknown'],
    description: 'cmp_999 does not exist. The agent must say so and must not invent numbers.',
  },
  tools: { required: [], maxLlmSteps: 4 },
});

import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's5-paused',
  scenario: 'S5',
  question: 'Why did cmp_021 stop delivering installs?',
  expected: {
    causeKeywords: ['paused'],
    mustNotFlag: [{ campaignId: 'cmp_021', unlessMentions: 'paused' }],
    description: 'cmp_021 was paused 10 days ago; zero activity is expected, not a performance problem.',
  },
  tools: { required: [], maxLlmSteps: 5 },
});

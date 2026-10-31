import { defineCase } from './_helpers.js';

export default defineCase({
  id: 's5-installs-drop',
  scenario: 'S5',
  question: 'Which campaigns had the biggest drop in installs last week compared to the week before?',
  expected: {
    causeKeywords: ['paused'],
    mustNotFlag: [{ campaignId: 'cmp_021', unlessMentions: 'paused' }],
    description: 'Apart from the paused cmp_021 (which must be described as paused, not as a drop), no campaign lost installs materially.',
  },
  tools: { required: ['compare_campaign_periods'], maxLlmSteps: 6 },
});

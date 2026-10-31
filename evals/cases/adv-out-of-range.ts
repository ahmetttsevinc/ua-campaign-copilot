import { defineCase } from './_helpers.js';

export default defineCase({
  id: 'adv-out-of-range',
  scenario: 'ADV',
  question: 'How did cmp_007 perform in December 2026?',
  expected: {
    emptyFindings: true,
    causeKeywords: ['no data', 'not available', 'only through', 'up to', 'future', 'beyond', 'not yet', 'only covers', 'complete up to'],
    description: 'Data ends on 2026-11-01, so December 2026 has no data. The agent must say so instead of inventing performance.',
  },
  tools: { required: [], maxLlmSteps: 5 },
});

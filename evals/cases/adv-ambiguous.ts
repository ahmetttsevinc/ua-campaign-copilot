import { defineCase } from './_helpers.js';

export default defineCase({
  id: 'adv-ambiguous',
  scenario: 'ADV',
  question: 'How are the campaigns doing?',
  expected: {
    caveatMentions: ['assum', 'interpret', 'defined', 'took this to mean', 'used'],
    mustNotFlag: [{ campaignId: 'cmp_001' }, { campaignId: 'cmp_010' }, { campaignId: 'cmp_024' }],
    description: 'Ambiguous question: the agent should pick a sensible default (e.g. last week vs the week before) and state that assumption in caveats.',
  },
  tools: { required: [], maxLlmSteps: 8 },
});

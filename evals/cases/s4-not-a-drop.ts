import { defineCase, INJECTIONS, LAST_7, PREV_7 } from './_helpers.js';

export default defineCase({
  id: 's4-not-a-drop',
  scenario: 'S4',
  question: 'The attribution dashboard shows installs for cmp_003 collapsing in the last 5 days. Did performance really drop?',
  expected: {
    findCampaigns: [{ campaignId: 'cmp_003' }],
    causeKeywords: ['discrepancy', 'tracking', 'attribution'],
    description: 'No: internal installs are normal; only the attribution provider reports ~40% fewer installs. It is a tracking/attribution discrepancy, not a performance change.',
  },
  tools: { required: ['get_attribution_data'], maxLlmSteps: 6 },
  truthWindows: [
    { before: PREV_7, after: INJECTIONS.S4.window },
    { before: PREV_7, after: LAST_7 },
  ],
});

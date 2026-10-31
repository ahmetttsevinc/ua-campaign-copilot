import { defineCase, HEALTHY_CONTROL_IDS, notFlagged } from './_helpers.js';

export default defineCase({
  id: 's1-roas-drop-top3',
  scenario: 'S1',
  question: 'Which 3 campaigns had the biggest ROAS drop last week compared to the week before, and why?',
  expected: {
    findCampaigns: [
      { campaignId: 'cmp_007', direction: 'down', metricAnyOf: ['roas'] },
      { campaignId: 'cmp_012', direction: 'down', metricAnyOf: ['roas', 'cpi'] },
    ],
    causeKeywords: ['fraud', 'click injection', 'ctit', 'suspicious'],
    mustNotFlag: [...notFlagged(HEALTHY_CONTROL_IDS), { campaignId: 'cmp_021', unlessMentions: 'paused' }],
    description:
      'cmp_007 ROAS fell ~49% due to click-injection fraud (30% suspicious installs, CTIT ~5 s); cmp_012 ROAS fell ~47% because spend doubled while installs rose ~10% (equivalently: CPI rose ~86%). The third-largest drop (cmp_008, about -5%) is minor; listing it as third is correct if it is described as minor/normal variance.',
  },
  tools: { required: ['compare_campaign_periods', 'get_fraud_signals'], maxLlmSteps: 8 },
});

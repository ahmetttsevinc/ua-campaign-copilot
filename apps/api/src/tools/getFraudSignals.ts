import { GetFraudSignalsInput, GetFraudSignalsOutput, MAX_ROWS } from '@copilot/shared';
import { median, ratio, roundTo } from '../lib/numbers.js';
import type { FraudCsvRow } from '../sources/fraudCsv/loader.js';
import { defineTool } from './types.js';

// Thresholds live in code, not in the prompt, so the model reports flags instead of judging raw numbers.
export const FRAUD_THRESHOLDS = {
  /** Average share of installs the vendor marks suspicious; healthy traffic sits around 1-5%. */
  suspiciousInstallRate: 0.1,
  /** Median click-to-install under 10 s is physically implausible for a real download: click injection. */
  clickInjectionCtitSeconds: 10,
  /** Single flagged sub-publisher days are background noise; repeated flags are a signal. */
  flaggedSubPublisherDays: 3,
};

type Flag = GetFraudSignalsOutput['campaigns'][number]['flags'][number];

export const getFraudSignals = defineTool({
  name: 'get_fraud_signals',
  description:
    "Fraud vendor's daily signals per campaign: suspicious install rate, median click-to-install time (CTIT) " +
    'and flagged sub-publishers, summarised over a period with ready-made flags (high_suspicious_install_rate, ' +
    'click_injection_suspected, repeatedly_flagged_sub_publishers). Use it when installs look fine but revenue ' +
    'or ROAS dropped, or whenever fraud is asked about. A campaign with no flags shows no evidence of fraud. ' +
    'Compare against an earlier period by calling it twice.',
  input: GetFraudSignalsInput,
  output: GetFraudSignalsOutput,
  async execute(input, { fraud }) {
    const wanted = input.campaignIds ? new Set(input.campaignIds) : null;
    const rows = (await fraud.rows()).filter(
      (r) =>
        r.date >= input.period.from &&
        r.date <= input.period.to &&
        (!wanted || wanted.has(r.campaignId)) &&
        (!input.country || r.country === input.country),
    );

    const byCampaign = new Map<string, FraudCsvRow[]>();
    for (const r of rows) {
      const key = `${r.campaignId}|${r.country}`;
      byCampaign.set(key, [...(byCampaign.get(key) ?? []), r]);
    }

    let dailyBudget = MAX_ROWS;
    let truncated = false;
    const campaigns = [...byCampaign.values()]
      .map((list) => {
        const first = list[0] as FraudCsvRow;
        const rates = list.map((r) => r.suspiciousInstallRate);
        const ctits = list.map((r) => r.medianCtitSeconds);
        const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
        const medianCtit = median(ctits);
        const flaggedDays = list.filter((r) => r.flaggedSubPublishers.length > 0).length;
        const flags: Flag[] = [];
        if (avgRate >= FRAUD_THRESHOLDS.suspiciousInstallRate) flags.push('high_suspicious_install_rate');
        if (medianCtit < FRAUD_THRESHOLDS.clickInjectionCtitSeconds) flags.push('click_injection_suspected');
        if (flaggedDays >= FRAUD_THRESHOLDS.flaggedSubPublisherDays) flags.push('repeatedly_flagged_sub_publishers');
        return {
          campaignId: first.campaignId,
          country: first.country,
          days: list.length,
          avgSuspiciousInstallRate: ratio(avgRate),
          maxSuspiciousInstallRate: ratio(Math.max(...rates)),
          medianCtitSeconds: roundTo(medianCtit, 1),
          minCtitSeconds: roundTo(Math.min(...ctits), 1),
          flaggedSubPublishers: [...new Set(list.flatMap((r) => r.flaggedSubPublishers))].sort(),
          flags,
          list,
        };
      })
      .filter((c) => !input.onlyFlagged || c.flags.length > 0)
      // Most suspicious first so truncation drops the boring ones.
      .sort((a, b) => b.flags.length - a.flags.length || b.avgSuspiciousInstallRate - a.avgSuspiciousInstallRate);

    const shown = campaigns.slice(0, MAX_ROWS).map(({ list, ...summary }) => {
      if (!input.includeDaily) return summary;
      const take = list.slice(0, Math.max(0, dailyBudget));
      if (take.length < list.length) truncated = true;
      dailyBudget -= take.length;
      return {
        ...summary,
        daily: take.map((r) => ({
          date: r.date,
          suspiciousInstallRate: r.suspiciousInstallRate,
          medianCtitSeconds: r.medianCtitSeconds,
          flaggedSubPublishers: r.flaggedSubPublishers,
        })),
      };
    });
    if (campaigns.length > MAX_ROWS) truncated = true;

    const seen = new Set(rows.map((r) => r.campaignId));
    return {
      period: input.period,
      thresholds: {
        suspiciousInstallRate: FRAUD_THRESHOLDS.suspiciousInstallRate,
        clickInjectionCtitSeconds: FRAUD_THRESHOLDS.clickInjectionCtitSeconds,
      },
      campaigns: shown,
      campaignsWithoutData: input.campaignIds?.filter((id) => !seen.has(id)) ?? [],
      truncated,
      ...(truncated ? { note: `Output capped at ${MAX_ROWS} rows; narrow campaignIds or disable includeDaily.` } : {}),
    };
  },
});

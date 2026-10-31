import { dateRange, weekday } from '../../lib/dates.js';
import { CAMPAIGNS } from './catalog.js';
import { between, hashString, mulberry32, noise, type Rng } from './random.js';
import { DATA_END_DATE, DATA_START_DATE, INJECTIONS, SEED } from './scenarios.js';

/**
 * Pure data generation, no I/O. Keeping it pure lets tests assert on the dataset
 * without a database and makes determinism trivial to verify.
 */

export interface MetricRow {
  campaignId: string;
  date: string;
  spendUsd: number;
  clicks: number;
  installs: number;
  revenueUsd: number;
}

export interface AttributionRow {
  date: string;
  installs: number;
  d1_retention: number;
  d7_retention: number;
  purchase_events: number;
}

export interface FraudRow {
  date: string;
  campaign_id: string;
  country: string;
  suspicious_install_rate: number;
  median_ctit_seconds: number;
  flagged_sub_publishers: string[];
}

export interface Dataset {
  metrics: MetricRow[];
  mappings: { internalCampaignId: string; attributionCampaignId: string }[];
  attribution: Record<string, AttributionRow[]>;
  fraud: FraudRow[];
}

// Index 0 = Sunday. Mobile UA traffic peaks at weekends.
const WEEKDAY_SEASONALITY = [1.12, 0.95, 0.94, 0.97, 1.0, 1.05, 1.15];

const inWindow = (date: string, w: { from: string; to: string }) => date >= w.from && date <= w.to;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function attributionId(rng: Rng, taken: Set<string>): string {
  for (;;) {
    const id = `af_${Math.floor(rng() * 0x10000).toString(16).padStart(4, '0')}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export function generateDataset(): Dataset {
  const dates = dateRange(DATA_START_DATE, DATA_END_DATE);
  const metrics: MetricRow[] = [];
  const mappings: Dataset['mappings'] = [];
  const attribution: Dataset['attribution'] = {};
  const fraud: FraudRow[] = [];
  const takenIds = new Set<string>();
  const idRng = mulberry32(hashString(`${SEED}:attribution-ids`));

  for (const c of CAMPAIGNS) {
    // One independent stream per campaign: editing one scenario never reshuffles the others.
    const rng = mulberry32(hashString(`${SEED}:${c.id}`));
    const baseSpend = between(rng, 400, 3000);
    const baseCpi = c.platform === 'ios' ? between(rng, 2.5, 6) : between(rng, 1.2, 3.5);
    const baseRoas = between(rng, 0.9, 1.5);
    const conversionRate = between(rng, 0.06, 0.18); // installs per click
    const baseD1 = between(rng, 0.25, 0.45);
    const baseD7 = between(rng, 0.08, 0.18);
    const purchaseRate = between(rng, 0.03, 0.09); // purchase events per install
    const baseSuspicious = between(rng, 0.01, 0.05);
    const baseCtit = between(rng, 45, 180);

    const attrId = attributionId(idRng, takenIds);
    mappings.push({ internalCampaignId: c.id, attributionCampaignId: attrId });
    const attrRows: AttributionRow[] = [];

    for (const date of dates) {
      if (c.id === INJECTIONS.S5.campaignId && date >= INJECTIONS.S5.pausedFrom) {
        // Paused campaigns produce no rows anywhere, like a real ad server would.
        continue;
      }

      const season = WEEKDAY_SEASONALITY[weekday(date)] ?? 1;
      let spend = baseSpend * season * noise(rng, 0.1);
      let installs = (spend / baseCpi) * noise(rng, 0.1);
      let revenue = installs * baseCpi * baseRoas * noise(rng, 0.1);
      let clicks = (installs / conversionRate) * noise(rng, 0.08);

      const s1 = INJECTIONS.S1;
      const isS1 = c.id === s1.campaignId && inWindow(date, s1.window);
      if (isS1) {
        installs *= s1.installsMultiplier;
        revenue *= s1.revenueMultiplier;
        clicks *= s1.clicksMultiplier;
      }
      const s2 = INJECTIONS.S2;
      if (c.id === s2.campaignId && inWindow(date, s2.window)) {
        spend *= s2.spendMultiplier;
        installs *= s2.installsMultiplier;
        revenue *= s2.revenueMultiplier;
        clicks *= s2.clicksMultiplier;
      }

      const installsInt = Math.round(installs);
      metrics.push({
        campaignId: c.id,
        date,
        spendUsd: round2(spend),
        clicks: Math.round(clicks),
        installs: installsInt,
        revenueUsd: round2(revenue),
      });

      // Attribution providers typically under-count a few percent versus the ad network.
      let attrInstalls = installsInt * (1 - between(rng, 0.02, 0.08));
      if (c.id === INJECTIONS.S4.campaignId && inWindow(date, INJECTIONS.S4.window)) {
        attrInstalls = installsInt * INJECTIONS.S4.attributionInstallsMultiplier;
      }
      let d7 = baseD7 * noise(rng, 0.1);
      if (c.id === INJECTIONS.S3.campaignId && inWindow(date, INJECTIONS.S3.window)) {
        d7 *= INJECTIONS.S3.d7RetentionMultiplier;
      }
      const attrInstallsInt = Math.round(attrInstalls);
      attrRows.push({
        date,
        installs: attrInstallsInt,
        d1_retention: round4(baseD1 * noise(rng, 0.1)),
        d7_retention: round4(d7),
        // Fraudulent installs never purchase, so purchases follow revenue rather than installs.
        purchase_events: Math.round(attrInstallsInt * purchaseRate * noise(rng, 0.2) * (isS1 ? s1.revenueMultiplier : 1)),
      });

      fraud.push({
        date,
        campaign_id: c.id,
        country: c.country,
        suspicious_install_rate: round4(
          isS1 ? between(rng, s1.suspiciousInstallRate.min, s1.suspiciousInstallRate.max) : baseSuspicious * noise(rng, 0.4),
        ),
        median_ctit_seconds: Math.round(
          (isS1 ? between(rng, s1.medianCtitSeconds.min, s1.medianCtitSeconds.max) : baseCtit * noise(rng, 0.2)) * 10,
        ) / 10,
        // Background noise: the vendor flags the odd sub-publisher on healthy campaigns too.
        flagged_sub_publishers: isS1
          ? [...s1.flaggedSubPublishers]
          : rng() < 0.04
            ? [`sp_${Math.floor(between(rng, 1000, 9999))}`]
            : [],
      });
    }
    attribution[attrId] = attrRows;
  }

  return { metrics, mappings, attribution, fraud };
}

export function fraudRowsToCsv(rows: FraudRow[]): string {
  const header = 'date,campaign_id,country,suspicious_install_rate,median_ctit_seconds,flagged_sub_publishers';
  const lines = rows.map((r) =>
    [r.date, r.campaign_id, r.country, r.suspicious_install_rate, r.median_ctit_seconds, r.flagged_sub_publishers.join(';')].join(','),
  );
  return `${header}\n${lines.join('\n')}\n`;
}

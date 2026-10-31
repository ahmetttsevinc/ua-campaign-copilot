// Fixed catalogue: hand-written so scenario campaigns have known, explainable attributes.
// Advertiser and app names are invented.

export const ADVERTISERS = [
  { id: 'adv_01', name: 'Pixelmoss Games', vertical: 'gaming' },
  { id: 'adv_02', name: 'Northwind Bank', vertical: 'fintech' },
  { id: 'adv_03', name: 'Tidewater Puzzles', vertical: 'gaming' },
  { id: 'adv_04', name: 'Cartly', vertical: 'shopping' },
  { id: 'adv_05', name: 'Coinleaf', vertical: 'fintech' },
  { id: 'adv_06', name: 'Emberfall Studios', vertical: 'gaming' },
  { id: 'adv_07', name: 'Streamhaus', vertical: 'streaming' },
  { id: 'adv_08', name: 'Bazaarly', vertical: 'shopping' },
] as const;

type Platform = 'ios' | 'android';
type Payout = 'cpi' | 'cpa';

// [app name, country, platform, payout model] per campaign, three per advertiser in order.
const ROWS: [string, string, Platform, Payout][] = [
  ['Merge Meadow', 'US', 'ios', 'cpi'], // cmp_001
  ['Merge Meadow', 'DE', 'android', 'cpi'], // cmp_002
  ['Merge Meadow', 'GB', 'ios', 'cpi'], // cmp_003 (S4)
  ['Northwind Pay', 'DE', 'ios', 'cpa'], // cmp_004
  ['Northwind Pay', 'DE', 'android', 'cpa'], // cmp_005
  ['Northwind Pay', 'AT', 'android', 'cpa'], // cmp_006
  ['Tile Tide', 'US', 'android', 'cpi'], // cmp_007 (S1)
  ['Tile Tide', 'BR', 'android', 'cpi'], // cmp_008
  ['Tile Tide', 'CA', 'ios', 'cpi'], // cmp_009
  ['Cartly', 'US', 'ios', 'cpa'], // cmp_010
  ['Cartly', 'GB', 'android', 'cpa'], // cmp_011
  ['Cartly', 'FR', 'ios', 'cpa'], // cmp_012 (S2)
  ['Coinleaf', 'US', 'ios', 'cpa'], // cmp_013
  ['Coinleaf', 'GB', 'ios', 'cpa'], // cmp_014
  ['Coinleaf', 'NL', 'android', 'cpa'], // cmp_015
  ['Ember Legends', 'US', 'ios', 'cpi'], // cmp_016
  ['Ember Legends', 'JP', 'ios', 'cpi'], // cmp_017
  ['Ember Legends', 'DE', 'android', 'cpi'], // cmp_018 (S3)
  ['Streamhaus', 'US', 'android', 'cpa'], // cmp_019
  ['Streamhaus', 'MX', 'android', 'cpa'], // cmp_020
  ['Streamhaus', 'ES', 'ios', 'cpa'], // cmp_021 (S5, paused)
  ['Bazaarly', 'TR', 'android', 'cpi'], // cmp_022
  ['Bazaarly', 'PL', 'android', 'cpi'], // cmp_023
  ['Bazaarly', 'IT', 'ios', 'cpi'], // cmp_024
];

export interface CatalogCampaign {
  id: string;
  advertiserId: string;
  name: string;
  country: string;
  platform: Platform;
  payoutModel: Payout;
}

export const CAMPAIGNS: CatalogCampaign[] = ROWS.map(([app, country, platform, payoutModel], i) => {
  const advertiser = ADVERTISERS[Math.floor(i / 3)];
  if (!advertiser) throw new Error(`No advertiser for campaign index ${i}`);
  return {
    id: `cmp_${String(i + 1).padStart(3, '0')}`,
    advertiserId: advertiser.id,
    name: `${app} | ${country} | ${platform === 'ios' ? 'iOS' : 'Android'}`,
    country,
    platform,
    payoutModel,
  };
});

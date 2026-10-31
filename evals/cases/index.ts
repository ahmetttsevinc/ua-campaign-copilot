import { EvalCase } from '../types.js';
import adv1 from './adv-unknown-campaign.js';
import adv2 from './adv-ambiguous.js';
import adv3 from './adv-attribution-down.js';
import adv4 from './adv-out-of-range.js';
import s1a from './s1-roas-drop-top3.js';
import s1b from './s1-fraud-direct.js';
import s1c from './s1-revenue-by-name.js';
import s2a from './s2-cpi-up.js';
import s2b from './s2-spend-change.js';
import s3a from './s3-quality-portfolio.js';
import s3b from './s3-quality-direct.js';
import s4a from './s4-reconcile-all.js';
import s4b from './s4-not-a-drop.js';
import s5a from './s5-paused.js';
import s5b from './s5-installs-drop.js';
import s6a from './s6-healthy-campaign.js';
import s6b from './s6-monday-summary.js';

// Validated at load time: a malformed case fails the run before any money is spent.
export const CASES: EvalCase[] = [s1a, s1b, s1c, s2a, s2b, s3a, s3b, s4a, s4b, s5a, s5b, s6a, s6b, adv1, adv2, adv3, adv4].map((c) => EvalCase.parse(c));

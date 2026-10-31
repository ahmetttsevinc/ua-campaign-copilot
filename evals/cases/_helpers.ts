import { HEALTHY_CONTROL_IDS, INJECTIONS, LAST_7, PREV_7 } from '../../apps/api/src/db/seed/scenarios.js';
import type { EvalCaseInput } from '../types.js';

export { HEALTHY_CONTROL_IDS, INJECTIONS, LAST_7, PREV_7 };
export const defineCase = (c: EvalCaseInput): EvalCaseInput => c;
export const notFlagged = (ids: string[]) => ids.map((campaignId) => ({ campaignId }));

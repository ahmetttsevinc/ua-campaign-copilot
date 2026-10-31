import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const FRAUD_CSV_FILE = 'fraud_signals.csv';
const EXPECTED_HEADER = 'date,campaign_id,country,suspicious_install_rate,median_ctit_seconds,flagged_sub_publishers';

// Vendor files are untrusted input: validate every row instead of trusting the format.
const FraudCsvRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaignId: z.string().min(1),
  country: z.string().length(2),
  suspiciousInstallRate: z.coerce.number().min(0).max(1),
  medianCtitSeconds: z.coerce.number().nonnegative(),
  flaggedSubPublishers: z.array(z.string()),
});
export type FraudCsvRow = z.infer<typeof FraudCsvRow>;

export function parseFraudCsv(text: string): FraudCsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines[0]?.trim() !== EXPECTED_HEADER) {
    throw new Error(`Unexpected fraud CSV header: "${lines[0] ?? ''}"`);
  }
  return lines.slice(1).map((line, i) => {
    const cols = line.split(',');
    if (cols.length !== 6) throw new Error(`Fraud CSV line ${i + 2}: expected 6 columns, got ${cols.length}`);
    const [date, campaignId, country, rate, ctit, subPubs] = cols;
    const parsed = FraudCsvRow.safeParse({
      date,
      campaignId,
      country,
      suspiciousInstallRate: rate,
      medianCtitSeconds: ctit,
      flaggedSubPublishers: subPubs ? subPubs.split(';').filter(Boolean) : [],
    });
    if (!parsed.success) {
      throw new Error(`Fraud CSV line ${i + 2}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
    }
    return parsed.data;
  });
}

export interface FraudStore {
  rows(): Promise<FraudCsvRow[]>;
}

/**
 * Reads the vendor's daily export lazily and re-reads only when the file changes, so a
 * re-seed is picked up without restarting the server.
 */
export function createFraudStore(dataDir: string): FraudStore {
  const file = path.join(dataDir, FRAUD_CSV_FILE);
  let cache: { mtimeMs: number; rows: FraudCsvRow[] } | undefined;
  return {
    async rows() {
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(file)).mtimeMs;
      } catch {
        throw new Error(`Fraud signals file not found at ${file}. Run "pnpm db:seed".`);
      }
      if (!cache || cache.mtimeMs !== mtimeMs) {
        cache = { mtimeMs, rows: parseFraudCsv(await readFile(file, 'utf8')) };
      }
      return cache.rows;
    },
  };
}

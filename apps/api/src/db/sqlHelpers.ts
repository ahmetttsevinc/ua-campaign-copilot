import { sql } from 'drizzle-orm';

// Drizzle expands a bare JS array into "($1, $2, ...)"; wrapping it in sql.param binds it
// as a single Postgres array, which works with = ANY(...) and with zero elements.
export const textArray = (values: string[]) => sql`${sql.param(values)}::text[]`;

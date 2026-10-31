import postgres from 'postgres';

// Dev convenience: drop everything so migrate + seed start from scratch.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { onnotice: () => undefined });
await sql`DROP SCHEMA IF EXISTS public CASCADE`;
await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
await sql`CREATE SCHEMA public`;
await sql.end();
console.log('Database reset');

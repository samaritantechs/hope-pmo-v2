import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;   // service role, NOT the anon key -- migration needs to bypass RLS

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your environment.');
  console.error('Get these from Supabase Dashboard -> Project Settings -> API.');
  console.error('Run with:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate -- <file> <type>');
  process.exit(1);
}

export const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Batched insert -- Supabase/Postgres handle large inserts fine, but chunking keeps any
    single request well clear of payload limits and gives visible progress on a big file. */
export async function insertBatched(table, rows, batchSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`Insert into ${table} failed at row ${i}: ${error.message}`);
    inserted += batch.length;
    process.stdout.write(`\r  ${table}: ${inserted}/${rows.length}`);
  }
  process.stdout.write('\n');
  return inserted;
}

/**
 * Run SQL migration against Supabase.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '001_create_tables.sql'),
  'utf-8'
);

async function migrate() {
  console.log('Running migration...');

  // Use Supabase's SQL endpoint via the REST API
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    console.log('Note: Direct SQL via REST may not be supported.');
    console.log('Please run the migration SQL directly in the Supabase SQL Editor:');
    console.log('  1. Go to your Supabase Dashboard -> SQL Editor');
    console.log('  2. Paste the contents of supabase/migrations/001_create_tables.sql');
    console.log('  3. Click "Run"');
    console.log('');
    console.log('Then seed directories with: npm run db:seed');
  } else {
    console.log('Migration completed successfully!');
  }
}

migrate().catch(console.error);

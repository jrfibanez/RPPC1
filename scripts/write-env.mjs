// Writes .env.local for local development from the running local Supabase stack.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const env = Object.fromEntries(
  out.split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  }),
);
writeFileSync('.env.local', [
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}`,
  `SUPABASE_DB_URL=${env.DB_URL}`,
  '',
].join('\n'));
console.log('Wrote .env.local');

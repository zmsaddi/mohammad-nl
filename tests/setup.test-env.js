import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.test') });

if (!process.env.POSTGRES_URL) {
  throw new Error('TEST-01: .env.test missing or POSTGRES_URL not set.');
}
if (!process.env.POSTGRES_URL.startsWith('postgresql://')) {
  throw new Error('TEST-01: POSTGRES_URL does not look like a valid Postgres URL.');
}

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

// `vite build` imports every server module to analyse the routes, with none of
// the runtime env set. Throwing or opening the real file there breaks the build.
if (!building && !env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(building ? ':memory:' : env.DATABASE_URL);

export const db = drizzle(client, { schema });

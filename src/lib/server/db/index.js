import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

/** @type {ReturnType<typeof drizzle<typeof schema>> | undefined} */
let db;

export function getDb() {
	if (db) {
		return db;
	}

	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required before the database client can be initialized.');
	}

	const client = neon(databaseUrl);
	db = drizzle(client, { schema });
	return db;
}

export { schema };

import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/neon-http';
import { getDb, schema } from '$lib/server/db';

export const authDatabaseConfigured = Boolean(process.env.DATABASE_URL);

const authDb = authDatabaseConfigured ? getDb() : drizzle.mock({ schema });
const baseURL = process.env.BETTER_AUTH_URL;
const trustedOrigins = parseList(process.env.BETTER_AUTH_TRUSTED_ORIGINS);
const passkeyOrigin = process.env.PASSKEY_ORIGIN ?? baseURL ?? 'http://localhost:5173';

export const auth = betterAuth({
	baseURL,
	trustedOrigins,
	database: drizzleAdapter(authDb, {
		provider: 'pg',
		schema,
		transaction: false
	}),
	emailAndPassword: {
		enabled: false
	},
	plugins: [
		passkey({
			rpName: 'Todolist',
			rpID: process.env.PASSKEY_RP_ID ?? getHostname(passkeyOrigin),
			origin: passkeyOrigin
		})
	]
});

/** @param {string | undefined} value */
function parseList(value) {
	if (!value) {
		return [];
	}

	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

/** @param {string} value */
function getHostname(value) {
	try {
		return new URL(value).hostname;
	} catch {
		return 'localhost';
	}
}

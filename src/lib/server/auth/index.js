import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/neon-http';
import { getDb, schema } from '$lib/server/db';

export const authDatabaseConfigured = Boolean(process.env.DATABASE_URL);
export const authConfigurationError = getAuthConfigurationError();

const authDb = authDatabaseConfigured ? getDb() : drizzle.mock({ schema });
const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173';
const secret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET ?? 'todolist-build-only-secret-change-me';
const trustedOrigins = parseList(process.env.BETTER_AUTH_TRUSTED_ORIGINS);
const passkeyOrigin = process.env.PASSKEY_ORIGIN ?? baseURL ?? 'http://localhost:5173';

export const auth = betterAuth({
	baseURL,
	secret,
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

function getAuthConfigurationError() {
	if (!authDatabaseConfigured || process.env.NODE_ENV !== 'production') {
		return null;
	}

	if (!process.env.BETTER_AUTH_SECRET && !process.env.AUTH_SECRET && !process.env.BETTER_AUTH_SECRETS) {
		return 'BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS must be configured before enabling auth in production.';
	}

	if (!process.env.BETTER_AUTH_URL) {
		return 'BETTER_AUTH_URL must be configured before enabling auth in production.';
	}

	return null;
}

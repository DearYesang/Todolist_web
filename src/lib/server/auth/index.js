import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/neon-http';
import { randomUUID } from 'node:crypto';
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
			origin: passkeyOrigin,
			registration: {
				requireSession: false,
				resolveUser: async ({ ctx, context }) => {
					const registration = parseRegistrationContext(context);
					const existing = await ctx.context.internalAdapter.findUserByEmail(registration.email);
					const userId = existing?.user.id ?? randomUUID();

					return {
						id: userId,
						name: registration.email,
						displayName: registration.name
					};
				},
				afterVerification: async ({ ctx, user, context }) => {
					const registration = parseRegistrationContext(context);
					const existing = await ctx.context.internalAdapter.findUserByEmail(registration.email);
					if (existing) {
						return { userId: existing.user.id };
					}

					const created = await ctx.context.internalAdapter.createUser({
						id: user.id,
						email: registration.email,
						name: registration.name,
						emailVerified: true
					});

					return { userId: created.id };
				}
			}
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

/** @param {string | null | undefined} context */
function parseRegistrationContext(context) {
	let parsed;
	try {
		parsed = context ? JSON.parse(context) : null;
	} catch {
		throw new Error('Invalid passkey registration context.');
	}

	const email = typeof parsed?.email === 'string' ? parsed.email.trim().toLowerCase() : '';
	const name = typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : email;
	if (!isEmail(email)) {
		throw new Error('A valid email is required for passkey registration.');
	}

	return { email, name };
}

/** @param {string} value */
function isEmail(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

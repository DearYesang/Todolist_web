import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/neon-http';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from '$lib/server/db';
import {
	assertValidPasskeyEmailCode,
	assertValidRecoveryCodeForEmail,
	consumePasskeyEmailCode,
	consumeRecoveryCodeForEmail,
	parsePasskeyRegistrationContext
} from './account-security.js';

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
					const registration = parsePasskeyRegistrationContext(context);
					const existing = await ctx.context.internalAdapter.findUserByEmail(registration.email);
					if (existing) {
						await assertValidRecoveryCodeForEmail(registration.email, registration.recoveryCode);
						return {
							id: existing.user.id,
							name: existing.user.email,
							displayName: existing.user.name
						};
					}

					await assertValidPasskeyEmailCode(registration.email, registration.emailVerificationCode);

					return {
						id: randomUUID(),
						name: registration.email,
						displayName: registration.name
					};
				},
				afterVerification: async ({ ctx, user, context }) => {
					const registration = parsePasskeyRegistrationContext(context);
					const existing = await ctx.context.internalAdapter.findUserByEmail(registration.email);
					if (existing) {
						await consumeRecoveryCodeForEmail(registration.email, registration.recoveryCode);
						return { userId: existing.user.id };
					}

					await consumePasskeyEmailCode(registration.email, registration.emailVerificationCode);
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

	if (hasPlaceholderSecret(process.env.BETTER_AUTH_SECRET) || hasPlaceholderSecret(process.env.AUTH_SECRET)) {
		return 'Auth secrets must be replaced before enabling auth in production.';
	}

	if (!process.env.BETTER_AUTH_URL) {
		return 'BETTER_AUTH_URL must be configured before enabling auth in production.';
	}

	if (!process.env.ACCOUNT_RECOVERY_SECRET && !process.env.BETTER_AUTH_SECRET && !process.env.AUTH_SECRET) {
		return 'ACCOUNT_RECOVERY_SECRET or BETTER_AUTH_SECRET must be configured before enabling account recovery in production.';
	}

	return null;
}

/** @param {string | undefined} value */
function hasPlaceholderSecret(value) {
	return Boolean(value && (value.includes('replace-with') || value.includes('change-me')));
}

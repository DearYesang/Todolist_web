import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/neon-http';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from '$lib/server/db';
import { getProductionConfigError } from '$lib/server/config/env.js';
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
const passkeyRpID = normalizeRpID(process.env.PASSKEY_RP_ID) ?? getHostname(passkeyOrigin);

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
			rpID: passkeyRpID,
			origin: passkeyOrigin,
			registration: {
				requireSession: false,
				resolveUser: async ({ ctx, context }) => {
					const registration = parsePasskeyRegistrationContext(context);
					const existing = await ctx.context.internalAdapter.findUserByEmail(registration.email);
					if (existing) {
						if (await userHasRegisteredPasskeys(ctx, existing.user.id)) {
							await assertValidRecoveryCodeForEmail(registration.email, registration.recoveryCode);
						} else {
							await assertValidPasskeyEmailCode(registration.email, registration.emailVerificationCode);
						}

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
						if (await userHasRegisteredPasskeys(ctx, existing.user.id)) {
							await consumeRecoveryCodeForEmail(registration.email, registration.recoveryCode);
						} else {
							await consumePasskeyEmailCode(registration.email, registration.emailVerificationCode);
						}

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
		return new URL(value).hostname.toLowerCase();
	} catch {
		return 'localhost';
	}
}

/** @param {string | undefined} value */
function normalizeRpID(value) {
	if (!value) {
		return null;
	}

	const trimmed = value.trim().toLowerCase();
	try {
		return new URL(trimmed).hostname;
	} catch {
		return trimmed;
	}
}

/**
 * @param {any} ctx
 * @param {string} userId
 */
async function userHasRegisteredPasskeys(ctx, userId) {
	const passkeys = await ctx.context.adapter.findMany({
		model: 'passkey',
		where: [{
			field: 'userId',
			value: userId
		}]
	});

	return passkeys.length > 0;
}

function getAuthConfigurationError() {
	if (!authDatabaseConfigured) {
		return null;
	}

	return getProductionConfigError();
}

import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';

const EMAIL_VERIFICATION_PREFIX = 'passkey-email-verification:';
const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const DEFAULT_RESEND_FROM = 'Todokanban <onboarding@resend.dev>';

export class AccountSecurityConfigurationError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'AccountSecurityConfigurationError';
		this.status = 503;
	}
}

export class AccountSecurityPolicyError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'AccountSecurityPolicyError';
		this.status = 403;
	}
}

/**
 * @param {unknown} value
 */
export function normalizeAccountEmail(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * @param {string} value
 */
export function isAccountEmail(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * @param {string} email
 */
export function assertAllowedAccountEmail(email) {
	const normalizedEmail = normalizeAccountEmail(email);
	const allowed = getAllowedAccountEmails();
	if (allowed.length > 0 && !allowed.includes(normalizedEmail)) {
		throw new AccountSecurityPolicyError('This email is not allowed to create an account.');
	}
}

export function getAllowedAccountEmails() {
	return parseEmailList(process.env.AUTH_ALLOWED_EMAILS);
}

/**
 * @param {string | null | undefined} context
 */
export function parsePasskeyRegistrationContext(context) {
	let parsed;
	try {
		parsed = context ? JSON.parse(context) : null;
	} catch {
		throw new Error('Invalid passkey registration context.');
	}

	const email = normalizeAccountEmail(parsed?.email);
	const name = typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : email;
	const emailVerificationCode = typeof parsed?.emailVerificationCode === 'string'
		? parsed.emailVerificationCode.trim()
		: '';
	const recoveryCode = typeof parsed?.recoveryCode === 'string' ? parsed.recoveryCode.trim() : '';

	if (!isAccountEmail(email)) {
		throw new Error('A valid email is required for passkey registration.');
	}
	assertAllowedAccountEmail(email);

	return { email, name, emailVerificationCode, recoveryCode };
}

/**
 * @param {{ email: unknown; name?: unknown }} input
 */
export async function createPasskeyEmailVerification(input) {
	const email = normalizeAccountEmail(input.email);
	if (!isAccountEmail(email)) {
		throw new AccountSecurityConfigurationError('A valid email is required.');
	}
	assertAllowedAccountEmail(email);

	const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : email;
	const code = createNumericCode();
	const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
	const identifier = getEmailVerificationIdentifier(email);
	const db = getDb();

	await db.delete(schema.verification).where(eq(schema.verification.identifier, identifier));
	await db.insert(schema.verification).values({
		id: randomId(),
		identifier,
		value: JSON.stringify({
			email,
			name,
			codeHash: hashEmailVerificationCode(email, code)
		}),
		expiresAt
	});

	const delivery = await deliverEmailVerification({ email, name, code, expiresAt });
	return {
		email,
		expiresAt: expiresAt.toISOString(),
		...(delivery.previewCode ? { previewCode: code } : {})
	};
}

/**
 * @param {string} email
 * @param {string} code
 */
export async function assertValidPasskeyEmailCode(email, code) {
	const record = await findValidEmailVerification(email, code);
	if (!record) {
		throw new Error('A valid email verification code is required for passkey registration.');
	}
}

/**
 * @param {string} email
 * @param {string} code
 */
export async function consumePasskeyEmailCode(email, code) {
	const record = await findValidEmailVerification(email, code);
	if (!record) {
		throw new Error('A valid email verification code is required for passkey registration.');
	}

	await getDb().delete(schema.verification).where(eq(schema.verification.id, record.id));
}

/**
 * @param {string} userId
 */
export async function getRecoveryCodeSummaryForUser(userId) {
	const rows = await getDb()
		.select({
			createdAt: schema.accountRecoveryCodes.createdAt,
			usedAt: schema.accountRecoveryCodes.usedAt
		})
		.from(schema.accountRecoveryCodes)
		.where(eq(schema.accountRecoveryCodes.userId, userId))
		.orderBy(desc(schema.accountRecoveryCodes.createdAt));

	return {
		total: rows.length,
		available: rows.filter((row) => !row.usedAt).length,
		lastCreatedAt: rows[0]?.createdAt?.toISOString() ?? null
	};
}

/**
 * @param {string} userId
 */
export async function createRecoveryCodesForUser(userId) {
	const now = new Date();
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
	const db = getDb();

	await db.delete(schema.accountRecoveryCodes).where(eq(schema.accountRecoveryCodes.userId, userId));
	await db.insert(schema.accountRecoveryCodes).values(codes.map((code) => ({
		userId,
		codeHash: hashRecoveryCode(userId, code),
		createdAt: now,
		usedAt: null
	})));

	return {
		codes,
		summary: {
			total: codes.length,
			available: codes.length,
			lastCreatedAt: now.toISOString()
		}
	};
}

/**
 * @param {string} userId
 */
export async function revokeRecoveryCodesForUser(userId) {
	await getDb().delete(schema.accountRecoveryCodes).where(eq(schema.accountRecoveryCodes.userId, userId));
	return getRecoveryCodeSummaryForUser(userId);
}

/**
 * @param {string} email
 * @param {string} code
 */
export async function assertValidRecoveryCodeForEmail(email, code) {
	const record = await findValidRecoveryCode(email, code);
	if (!record) {
		throw new Error('A valid recovery code is required to add a passkey for this account.');
	}
}

/**
 * @param {string} email
 * @param {string} code
 */
export async function consumeRecoveryCodeForEmail(email, code) {
	const record = await findValidRecoveryCode(email, code);
	if (!record) {
		throw new Error('A valid recovery code is required to add a passkey for this account.');
	}

	await getDb()
		.update(schema.accountRecoveryCodes)
		.set({ usedAt: new Date() })
		.where(and(eq(schema.accountRecoveryCodes.id, record.id), isNull(schema.accountRecoveryCodes.usedAt)));
}

/**
 * @param {string} email
 * @param {string} code
 */
async function findValidEmailVerification(email, code) {
	const normalizedEmail = normalizeAccountEmail(email);
	if (!isAccountEmail(normalizedEmail) || !code.trim()) {
		return null;
	}

	const [record] = await getDb()
		.select()
		.from(schema.verification)
		.where(and(
			eq(schema.verification.identifier, getEmailVerificationIdentifier(normalizedEmail)),
			gt(schema.verification.expiresAt, new Date())
		))
		.limit(1);

	if (!record) {
		return null;
	}

	const value = parseJsonObject(record.value);
	return value?.codeHash === hashEmailVerificationCode(normalizedEmail, code) ? record : null;
}

/**
 * @param {string} email
 * @param {string} code
 */
async function findValidRecoveryCode(email, code) {
	const normalizedEmail = normalizeAccountEmail(email);
	if (!isAccountEmail(normalizedEmail) || !normalizeRecoveryCode(code)) {
		return null;
	}

	const [user] = await getDb()
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, normalizedEmail))
		.limit(1);
	if (!user) {
		return null;
	}

	const [record] = await getDb()
		.select()
		.from(schema.accountRecoveryCodes)
		.where(and(
			eq(schema.accountRecoveryCodes.userId, user.id),
			eq(schema.accountRecoveryCodes.codeHash, hashRecoveryCode(user.id, code)),
			isNull(schema.accountRecoveryCodes.usedAt)
		))
		.limit(1);

	return record ?? null;
}

/**
 * @param {string} email
 */
function getEmailVerificationIdentifier(email) {
	return `${EMAIL_VERIFICATION_PREFIX}${email}`;
}

function createNumericCode() {
	return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function createRecoveryCode() {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const chars = Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]);
	return `td-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/**
 * @param {number} min
 * @param {number} max
 */
function randomInt(min, max) {
	const range = max - min;
	const value = randomBytes(4).readUInt32BE(0);
	return min + (value % range);
}

/**
 * @param {string} email
 * @param {string} code
 */
function hashEmailVerificationCode(email, code) {
	return createHmac('sha256', getAccountSecuritySecret())
		.update('email-verification')
		.update('\0')
		.update(email)
		.update('\0')
		.update(code.trim())
		.digest('hex');
}

/**
 * @param {string} userId
 * @param {string} code
 */
function hashRecoveryCode(userId, code) {
	return createHmac('sha256', getAccountSecuritySecret())
		.update('recovery-code')
		.update('\0')
		.update(userId)
		.update('\0')
		.update(normalizeRecoveryCode(code))
		.digest('hex');
}

/**
 * @param {string} value
 */
function normalizeRecoveryCode(value) {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getAccountSecuritySecret() {
	const secret = process.env.ACCOUNT_RECOVERY_SECRET
		?? process.env.BETTER_AUTH_SECRET
		?? process.env.AUTH_SECRET;

	if (!secret || isPlaceholderSecret(secret)) {
		throw new AccountSecurityConfigurationError('ACCOUNT_RECOVERY_SECRET or BETTER_AUTH_SECRET must be configured before account recovery can be used.');
	}

	if (process.env.NODE_ENV === 'production' && secret.length < 32) {
		throw new AccountSecurityConfigurationError('Account recovery secrets must be at least 32 characters in production.');
	}

	return secret;
}

/**
 * @param {{ email: string; name: string; code: string; expiresAt: Date }} message
 */
async function deliverEmailVerification(message) {
	const resendApiKey = process.env.RESEND_API_KEY;
	if (resendApiKey) {
		await sendResendVerificationEmail(message, resendApiKey);
		return { previewCode: false };
	}

	const webhookUrl = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
	if (webhookUrl) {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(process.env.EMAIL_DELIVERY_WEBHOOK_SECRET
					? { authorization: `Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_SECRET}` }
					: {})
			},
			body: JSON.stringify({
				type: 'passkey-email-verification',
				app: 'Todolist',
				email: message.email,
				name: message.name,
				code: message.code,
				expiresAt: message.expiresAt.toISOString()
			})
		});

		if (!response.ok) {
			throw new AccountSecurityConfigurationError('Email verification delivery failed.');
		}

		return { previewCode: false };
	}

	if (process.env.NODE_ENV !== 'production' || process.env.EMAIL_VERIFICATION_DEV_CODES === 'true') {
		return { previewCode: true };
	}

	throw new AccountSecurityConfigurationError('EMAIL_DELIVERY_WEBHOOK_URL must be configured before email verification can be used in production.');
}

/**
 * @param {{ email: string; name: string; code: string; expiresAt: Date }} message
 * @param {string} apiKey
 */
async function sendResendVerificationEmail(message, apiKey) {
	const from = process.env.EMAIL_FROM || DEFAULT_RESEND_FROM;
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json',
			'user-agent': 'todokanban-email/1.0'
		},
		body: JSON.stringify({
			from,
			to: [message.email],
			subject: 'Todokanban verification code',
			text: [
				`Hi ${message.name},`,
				'',
				`Your Todokanban verification code is ${message.code}.`,
				`It expires at ${message.expiresAt.toISOString()}.`,
				'',
				'If you did not request this code, you can ignore this email.'
			].join('\n'),
			html: `<p>Hi ${escapeHtml(message.name)},</p><p>Your Todokanban verification code is <strong>${message.code}</strong>.</p><p>It expires at ${message.expiresAt.toISOString()}.</p><p>If you did not request this code, you can ignore this email.</p>`
		})
	});

	if (!response.ok) {
		throw new AccountSecurityConfigurationError('Email verification delivery failed.');
	}
}

/**
 * @param {string} value
 */
function isPlaceholderSecret(value) {
	return value.includes('replace-with') || value.includes('change-me') || value.length === 0;
}

function randomId() {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * @param {string | undefined} value
 */
function parseEmailList(value) {
	return (value ?? '')
		.split(',')
		.map(normalizeAccountEmail)
		.filter(isAccountEmail);
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * @param {string} value
 */
function parseJsonObject(value) {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

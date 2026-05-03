const MIN_SECRET_LENGTH = 32;

/**
 * @typedef {'ok' | 'missing' | 'placeholder' | 'weak' | 'invalid' | 'optional'} ConfigCheckStatus
 * @typedef {{
 *   key: string;
 *   status: ConfigCheckStatus;
 *   required: boolean;
 *   message: string;
 * }} ConfigCheck
 */

export function getRuntimeConfigReport() {
	const authRequired = Boolean(process.env.DATABASE_URL) || process.env.NODE_ENV === 'production';
	const calendarProviderConfigured = Boolean(
		process.env.GOOGLE_CALENDAR_CLIENT_ID
		|| process.env.GOOGLE_CALENDAR_CLIENT_SECRET
		|| process.env.MICROSOFT_CALENDAR_CLIENT_ID
		|| process.env.MICROSOFT_CALENDAR_CLIENT_SECRET
	);
	const resendConfigured = Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_FROM);
	const webhookConfigured = Boolean(process.env.EMAIL_DELIVERY_WEBHOOK_URL);
	const emailDeliveryRequired = process.env.NODE_ENV === 'production'
		&& process.env.EMAIL_VERIFICATION_DEV_CODES !== 'true';
	const calendarFeedRequired = process.env.NODE_ENV === 'production';
	const checks = [
		checkDatabaseUrl(),
		checkSecret('BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET, authRequired),
		checkUrl('BETTER_AUTH_URL', process.env.BETTER_AUTH_URL, process.env.NODE_ENV === 'production'),
		checkTrustedOrigins(),
		checkUrl('PASSKEY_ORIGIN', process.env.PASSKEY_ORIGIN, process.env.NODE_ENV === 'production'),
		checkValue('PASSKEY_RP_ID', process.env.PASSKEY_RP_ID, process.env.NODE_ENV === 'production'),
		checkAllowedEmails(),
		checkSecret('ACCOUNT_RECOVERY_SECRET', process.env.ACCOUNT_RECOVERY_SECRET, authRequired),
		checkUrl('EMAIL_DELIVERY_WEBHOOK_URL', process.env.EMAIL_DELIVERY_WEBHOOK_URL, emailDeliveryRequired && !resendConfigured),
		checkSecret('EMAIL_DELIVERY_WEBHOOK_SECRET', process.env.EMAIL_DELIVERY_WEBHOOK_SECRET, false),
		checkSecret('RESEND_API_KEY', process.env.RESEND_API_KEY, emailDeliveryRequired && !webhookConfigured),
		checkValue('EMAIL_FROM', process.env.EMAIL_FROM, resendConfigured || (emailDeliveryRequired && !webhookConfigured)),
		checkSecret('CALENDAR_TOKEN_SECRET', process.env.CALENDAR_TOKEN_SECRET, calendarFeedRequired),
		checkSecret('CALENDAR_OAUTH_ENCRYPTION_KEY', process.env.CALENDAR_OAUTH_ENCRYPTION_KEY, calendarProviderConfigured),
		checkValue('GOOGLE_CALENDAR_CLIENT_ID', process.env.GOOGLE_CALENDAR_CLIENT_ID, false),
		checkSecret('GOOGLE_CALENDAR_CLIENT_SECRET', process.env.GOOGLE_CALENDAR_CLIENT_SECRET, false),
		checkValue('MICROSOFT_CALENDAR_CLIENT_ID', process.env.MICROSOFT_CALENDAR_CLIENT_ID, false),
		checkSecret('MICROSOFT_CALENDAR_CLIENT_SECRET', process.env.MICROSOFT_CALENDAR_CLIENT_SECRET, false)
	];
	const blocking = checks.filter((check) => check.required && check.status !== 'ok');

	return {
		ok: blocking.length === 0,
		nodeEnv: process.env.NODE_ENV ?? 'development',
		databaseConfigured: Boolean(process.env.DATABASE_URL),
		authReady: authRequired && isCheckOk(checks, 'BETTER_AUTH_SECRET') && isCheckOk(checks, 'BETTER_AUTH_URL'),
		emailDeliveryReady: (
			isCheckOk(checks, 'EMAIL_DELIVERY_WEBHOOK_URL')
			|| (isCheckOk(checks, 'RESEND_API_KEY') && isCheckOk(checks, 'EMAIL_FROM'))
			|| process.env.EMAIL_VERIFICATION_DEV_CODES === 'true'
		),
		calendarFeedReady: isCheckOk(checks, 'CALENDAR_TOKEN_SECRET'),
		calendarProviderReady: isCheckOk(checks, 'CALENDAR_OAUTH_ENCRYPTION_KEY') && (
			hasProvider('GOOGLE_CALENDAR') || hasProvider('MICROSOFT_CALENDAR')
		),
		checks,
		blocking
	};
}

export function getProductionConfigError() {
	const report = getRuntimeConfigReport();
	return report.blocking[0]?.message ?? null;
}

/**
 * @param {unknown} value
 */
export function isPlaceholderValue(value) {
	return typeof value === 'string'
		&& (value.includes('replace-with') || value.includes('change-me') || value.trim() === '');
}

/**
 * @param {ConfigCheck[]} checks
 * @param {string} key
 */
function isCheckOk(checks, key) {
	return checks.find((check) => check.key === key)?.status === 'ok';
}

/**
 * @param {string} prefix
 */
function hasProvider(prefix) {
	return Boolean(process.env[`${prefix}_CLIENT_ID`] && process.env[`${prefix}_CLIENT_SECRET`]);
}

function checkDatabaseUrl() {
	const value = process.env.DATABASE_URL;
	if (!value) {
		return createCheck('DATABASE_URL', false, 'optional', 'DATABASE_URL is not configured; server APIs will return 503.');
	}

	if (isPlaceholderValue(value)) {
		return createCheck('DATABASE_URL', true, 'placeholder', 'DATABASE_URL must be replaced before deployment.');
	}

	if (!/^postgres(?:ql)?:\/\//.test(value)) {
		return createCheck('DATABASE_URL', true, 'invalid', 'DATABASE_URL must be a Postgres connection string.');
	}

	return createCheck('DATABASE_URL', true, 'ok', 'DATABASE_URL is configured.');
}

/**
 * @param {string} key
 * @param {string | undefined} value
 * @param {boolean} required
 */
function checkSecret(key, value, required) {
	if (!value) {
		return createCheck(key, required, required ? 'missing' : 'optional', `${key} is ${required ? 'required' : 'optional'}.`);
	}

	if (isPlaceholderValue(value)) {
		return createCheck(key, required, 'placeholder', `${key} must be replaced.`);
	}

	if (value.length < MIN_SECRET_LENGTH) {
		return createCheck(key, required, 'weak', `${key} should be at least ${MIN_SECRET_LENGTH} characters.`);
	}

	return createCheck(key, required, 'ok', `${key} is configured.`);
}

/**
 * @param {string} key
 * @param {string | undefined} value
 * @param {boolean} required
 */
function checkUrl(key, value, required) {
	if (!value) {
		return createCheck(key, required, required ? 'missing' : 'optional', `${key} is ${required ? 'required' : 'optional'}.`);
	}

	if (isPlaceholderValue(value)) {
		return createCheck(key, required, 'placeholder', `${key} must be replaced.`);
	}

	try {
		const parsed = new URL(value);
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			return createCheck(key, required, 'invalid', `${key} must use http or https.`);
		}
	} catch {
		return createCheck(key, required, 'invalid', `${key} must be a valid URL.`);
	}

	return createCheck(key, required, 'ok', `${key} is configured.`);
}

function checkTrustedOrigins() {
	const value = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
	if (!value) {
		return createCheck('BETTER_AUTH_TRUSTED_ORIGINS', process.env.NODE_ENV === 'production', process.env.NODE_ENV === 'production' ? 'missing' : 'optional', 'BETTER_AUTH_TRUSTED_ORIGINS should list deployed app origins.');
	}

	const invalid = value
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean)
		.some((origin) => {
			try {
				const parsed = new URL(origin);
				return !['http:', 'https:'].includes(parsed.protocol);
			} catch {
				return true;
			}
		});

	return createCheck(
		'BETTER_AUTH_TRUSTED_ORIGINS',
		process.env.NODE_ENV === 'production',
		invalid ? 'invalid' : 'ok',
		invalid ? 'BETTER_AUTH_TRUSTED_ORIGINS contains an invalid origin.' : 'BETTER_AUTH_TRUSTED_ORIGINS is configured.'
	);
}

function checkAllowedEmails() {
	const value = process.env.AUTH_ALLOWED_EMAILS;
	if (!value) {
		return createCheck('AUTH_ALLOWED_EMAILS', process.env.NODE_ENV === 'production', process.env.NODE_ENV === 'production' ? 'missing' : 'optional', 'AUTH_ALLOWED_EMAILS should list the personal emails allowed to register.');
	}

	const emails = value
		.split(',')
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
	const invalid = emails.length === 0 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
	return createCheck(
		'AUTH_ALLOWED_EMAILS',
		process.env.NODE_ENV === 'production',
		invalid ? 'invalid' : 'ok',
		invalid ? 'AUTH_ALLOWED_EMAILS must contain comma-separated email addresses.' : 'AUTH_ALLOWED_EMAILS is configured.'
	);
}

/**
 * @param {string} key
 * @param {string | undefined} value
 * @param {boolean} required
 */
function checkValue(key, value, required) {
	if (!value) {
		return createCheck(key, required, required ? 'missing' : 'optional', `${key} is ${required ? 'required' : 'optional'}.`);
	}

	if (isPlaceholderValue(value)) {
		return createCheck(key, required, 'placeholder', `${key} must be replaced.`);
	}

	return createCheck(key, required, 'ok', `${key} is configured.`);
}

/**
 * @param {string} key
 * @param {boolean} required
 * @param {ConfigCheckStatus} status
 * @param {string} message
 * @returns {ConfigCheck}
 */
function createCheck(key, required, status, message) {
	return { key, required, status, message };
}

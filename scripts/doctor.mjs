const MIN_SECRET_LENGTH = 32;
const resendConfigured = Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_FROM);
const webhookConfigured = Boolean(process.env.EMAIL_DELIVERY_WEBHOOK_URL);
const emailDeliveryRequired = process.env.EMAIL_VERIFICATION_DEV_CODES !== 'true';
const checks = [
	checkDatabaseUrl(),
	checkSecret('BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET, true),
	checkUrl('BETTER_AUTH_URL', process.env.BETTER_AUTH_URL, true),
	checkUrlList('BETTER_AUTH_TRUSTED_ORIGINS', process.env.BETTER_AUTH_TRUSTED_ORIGINS, true),
	checkUrl('PASSKEY_ORIGIN', process.env.PASSKEY_ORIGIN, true),
	checkValue('PASSKEY_RP_ID', process.env.PASSKEY_RP_ID, true),
	checkEmailList('AUTH_ALLOWED_EMAILS', process.env.AUTH_ALLOWED_EMAILS, true),
	checkSecret('ACCOUNT_RECOVERY_SECRET', process.env.ACCOUNT_RECOVERY_SECRET, true),
	checkUrl('EMAIL_DELIVERY_WEBHOOK_URL', process.env.EMAIL_DELIVERY_WEBHOOK_URL, emailDeliveryRequired && !resendConfigured),
	checkSecret('EMAIL_DELIVERY_WEBHOOK_SECRET', process.env.EMAIL_DELIVERY_WEBHOOK_SECRET, false),
	checkSecret('RESEND_API_KEY', process.env.RESEND_API_KEY, emailDeliveryRequired && !webhookConfigured),
	checkValue('EMAIL_FROM', process.env.EMAIL_FROM, resendConfigured || (emailDeliveryRequired && !webhookConfigured)),
	checkSecret('CALENDAR_TOKEN_SECRET', process.env.CALENDAR_TOKEN_SECRET, true),
	checkSecret('CALENDAR_OAUTH_ENCRYPTION_KEY', process.env.CALENDAR_OAUTH_ENCRYPTION_KEY, hasCalendarProvider()),
	checkValue('GOOGLE_CALENDAR_CLIENT_ID', process.env.GOOGLE_CALENDAR_CLIENT_ID, false),
	checkSecret('GOOGLE_CALENDAR_CLIENT_SECRET', process.env.GOOGLE_CALENDAR_CLIENT_SECRET, false),
	checkValue('MICROSOFT_CALENDAR_CLIENT_ID', process.env.MICROSOFT_CALENDAR_CLIENT_ID, false),
	checkSecret('MICROSOFT_CALENDAR_CLIENT_SECRET', process.env.MICROSOFT_CALENDAR_CLIENT_SECRET, false),
	checkSecret('CRON_SECRET', process.env.CRON_SECRET, false),
	checkPositiveInteger('CALENDAR_BACKGROUND_SYNC_MAX_USERS', process.env.CALENDAR_BACKGROUND_SYNC_MAX_USERS, false)
];

const blocking = checks.filter((check) => check.required && check.status !== 'ok');
for (const check of checks) {
	const mark = check.status === 'ok' ? 'ok' : check.required ? 'fail' : 'warn';
	console.log(`${mark.padEnd(4)} ${check.key}: ${check.message}`);
}

if (blocking.length > 0) {
	console.error(`\n${blocking.length} required production configuration checks failed.`);
	process.exit(1);
}

console.log('\nProduction configuration checks passed.');

function hasCalendarProvider() {
	return Boolean(
		process.env.GOOGLE_CALENDAR_CLIENT_ID
		|| process.env.GOOGLE_CALENDAR_CLIENT_SECRET
		|| process.env.MICROSOFT_CALENDAR_CLIENT_ID
		|| process.env.MICROSOFT_CALENDAR_CLIENT_SECRET
	);
}

function checkDatabaseUrl() {
	const value = process.env.DATABASE_URL;
	if (!value) return createCheck('DATABASE_URL', true, 'missing', 'required for production database access.');
	if (isPlaceholder(value)) return createCheck('DATABASE_URL', true, 'placeholder', 'must be replaced.');
	if (!/^postgres(?:ql)?:\/\//.test(value)) return createCheck('DATABASE_URL', true, 'invalid', 'must be a Postgres URL.');
	return createCheck('DATABASE_URL', true, 'ok', 'configured.');
}

function checkSecret(key, value, required) {
	if (!value) return createCheck(key, required, required ? 'missing' : 'optional', required ? 'required.' : 'optional.');
	if (isPlaceholder(value)) return createCheck(key, required, 'placeholder', 'must be replaced.');
	if (value.length < MIN_SECRET_LENGTH) return createCheck(key, required, 'weak', `should be at least ${MIN_SECRET_LENGTH} characters.`);
	return createCheck(key, required, 'ok', 'configured.');
}

function checkUrl(key, value, required) {
	if (!value) return createCheck(key, required, required ? 'missing' : 'optional', required ? 'required.' : 'optional.');
	if (isPlaceholder(value)) return createCheck(key, required, 'placeholder', 'must be replaced.');
	try {
		const parsed = new URL(value);
		if (!['http:', 'https:'].includes(parsed.protocol)) return createCheck(key, required, 'invalid', 'must use http or https.');
		return createCheck(key, required, 'ok', 'configured.');
	} catch {
		return createCheck(key, required, 'invalid', 'must be a valid URL.');
	}
}

function checkUrlList(key, value, required) {
	if (!value) return createCheck(key, required, required ? 'missing' : 'optional', required ? 'required.' : 'optional.');
	const invalid = value.split(',').map((item) => item.trim()).filter(Boolean).some((item) => checkUrl(key, item, true).status !== 'ok');
	return createCheck(key, required, invalid ? 'invalid' : 'ok', invalid ? 'contains an invalid URL.' : 'configured.');
}

function checkEmailList(key, value, required) {
	if (!value) return createCheck(key, required, required ? 'missing' : 'optional', required ? 'required.' : 'optional.');
	const emails = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
	const invalid = emails.length === 0 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
	return createCheck(key, required, invalid ? 'invalid' : 'ok', invalid ? 'must contain comma-separated email addresses.' : 'configured.');
}

function checkValue(key, value, required) {
	if (!value) return createCheck(key, required, required ? 'missing' : 'optional', required ? 'required.' : 'optional.');
	if (isPlaceholder(value)) return createCheck(key, required, 'placeholder', 'must be replaced.');
	return createCheck(key, required, 'ok', 'configured.');
}

function checkPositiveInteger(key, value, required) {
	if (!value) return createCheck(key, required, required ? 'missing' : 'optional', required ? 'required.' : 'optional.');
	if (isPlaceholder(value)) return createCheck(key, required, 'placeholder', 'must be replaced.');
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0) return createCheck(key, required, 'invalid', 'must be a positive integer.');
	return createCheck(key, required, 'ok', 'configured.');
}

function isPlaceholder(value) {
	return value.includes('replace-with') || value.includes('change-me') || value.trim() === '';
}

function createCheck(key, required, status, message) {
	return { key, required, status, message };
}

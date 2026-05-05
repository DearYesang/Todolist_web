import { randomBytes } from 'node:crypto';

const secrets = [
	['BETTER_AUTH_SECRET', randomSecret(48), 'Better Auth session signing secret.'],
	['ACCOUNT_RECOVERY_SECRET', randomSecret(48), 'HMAC secret for recovery and email verification codes.'],
	['CALENDAR_TOKEN_SECRET', randomSecret(48), 'HMAC secret for revocable iCalendar feed tokens.'],
	['CALENDAR_OAUTH_ENCRYPTION_KEY', randomSecret(32), 'AES-GCM key material for Google/Microsoft OAuth tokens.'],
	['CRON_SECRET', randomSecret(32), 'Bearer secret automatically sent by Vercel Cron.'],
	['HEALTH_DETAILS_TOKEN', randomSecret(32), 'Optional bearer secret for detailed production health output.'],
	['EMAIL_DELIVERY_WEBHOOK_SECRET', randomSecret(32), 'Optional webhook bearer secret if Resend is not used.']
];

const args = new Set(process.argv.slice(2));
if (args.has('--json')) {
	console.log(JSON.stringify(Object.fromEntries(secrets.map(([key, value]) => [key, value])), null, 2));
} else {
	console.log('# Generated deployment secrets. Paste required values into Vercel Production env.');
	console.log('# Do not commit these values.');
	console.log('');
	for (const [key, value, note] of secrets) {
		console.log(`# ${note}`);
		console.log(`${key}="${value}"`);
		console.log('');
	}
}

/**
 * @param {number} bytes
 */
function randomSecret(bytes) {
	return randomBytes(bytes).toString('base64url');
}

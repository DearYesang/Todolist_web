import { afterEach, describe, expect, it } from 'vitest';
import { getProductionConfigError, getRuntimeConfigReport, isPlaceholderValue } from './env.js';

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe('runtime config report', () => {
	it('detects placeholder values and missing production config', () => {
		process.env.NODE_ENV = 'production';
		process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
		process.env.BETTER_AUTH_SECRET = 'replace-with-a-generated-32-byte-secret';
		delete process.env.BETTER_AUTH_URL;

		const report = getRuntimeConfigReport();
		expect(report.ok).toBe(false);
		expect(report.blocking.map((check) => check.key)).toContain('BETTER_AUTH_SECRET');
		expect(report.blocking.map((check) => check.key)).toContain('BETTER_AUTH_URL');
		expect(getProductionConfigError()).toMatch(/BETTER_AUTH_SECRET|BETTER_AUTH_URL/);
	});

	it('marks a fully configured production auth environment as ready', () => {
		process.env.NODE_ENV = 'production';
		process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
		process.env.BETTER_AUTH_SECRET = 'auth-secret-with-more-than-32-characters';
		process.env.BETTER_AUTH_URL = 'https://todo.example.com';
		process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://todo.example.com';
		process.env.PASSKEY_ORIGIN = 'https://todo.example.com';
		process.env.PASSKEY_RP_ID = 'todo.example.com';
		process.env.AUTH_ALLOWED_EMAILS = 'user@example.com';
		process.env.ACCOUNT_RECOVERY_SECRET = 'recovery-secret-with-more-than-32-characters';
		process.env.EMAIL_DELIVERY_WEBHOOK_URL = 'https://email.example.com/send';
		process.env.CALENDAR_TOKEN_SECRET = 'calendar-token-secret-with-more-than-32-characters';

		const report = getRuntimeConfigReport();
		expect(report.ok).toBe(true);
		expect(report.authReady).toBe(true);
		expect(report.emailDeliveryReady).toBe(true);
		expect(getProductionConfigError()).toBeNull();
	});

	it('accepts Resend as the production email delivery provider', () => {
		process.env.NODE_ENV = 'production';
		process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
		process.env.BETTER_AUTH_SECRET = 'auth-secret-with-more-than-32-characters';
		process.env.BETTER_AUTH_URL = 'https://todokanban-alpha.vercel.app';
		process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://todokanban-alpha.vercel.app';
		process.env.PASSKEY_ORIGIN = 'https://todokanban-alpha.vercel.app';
		process.env.PASSKEY_RP_ID = 'todokanban-alpha.vercel.app';
		process.env.AUTH_ALLOWED_EMAILS = 'scyea@naver.com,scyea1995@gmail.com';
		process.env.ACCOUNT_RECOVERY_SECRET = 'recovery-secret-with-more-than-32-characters';
		process.env.RESEND_API_KEY = 'resend-api-key-with-more-than-32-characters';
		process.env.EMAIL_FROM = 'Todokanban <onboarding@resend.dev>';
		process.env.CALENDAR_TOKEN_SECRET = 'calendar-token-secret-with-more-than-32-characters';

		const report = getRuntimeConfigReport();
		expect(report.ok).toBe(true);
		expect(report.emailDeliveryReady).toBe(true);
	});

	it('blocks production health when the current origin does not match auth and passkey origins', () => {
		process.env.NODE_ENV = 'production';
		process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
		process.env.BETTER_AUTH_SECRET = 'auth-secret-with-more-than-32-characters';
		process.env.BETTER_AUTH_URL = 'https://todokanban.vercel.app';
		process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://todokanban.vercel.app';
		process.env.PASSKEY_ORIGIN = 'https://todokanban.vercel.app';
		process.env.PASSKEY_RP_ID = 'todokanban.vercel.app';
		process.env.AUTH_ALLOWED_EMAILS = 'scyea@naver.com,scyea1995@gmail.com';
		process.env.ACCOUNT_RECOVERY_SECRET = 'recovery-secret-with-more-than-32-characters';
		process.env.RESEND_API_KEY = 'resend-api-key-with-more-than-32-characters';
		process.env.EMAIL_FROM = 'Todokanban <onboarding@resend.dev>';
		process.env.CALENDAR_TOKEN_SECRET = 'calendar-token-secret-with-more-than-32-characters';

		const report = getRuntimeConfigReport({ currentOrigin: 'https://todokanban-alpha.vercel.app' });

		expect(report.ok).toBe(false);
		expect(report.blocking.map((check) => check.key)).toEqual(expect.arrayContaining([
			'BETTER_AUTH_URL_CURRENT_ORIGIN',
			'BETTER_AUTH_TRUSTED_ORIGINS_CURRENT_ORIGIN',
			'PASSKEY_ORIGIN_CURRENT_ORIGIN',
			'PASSKEY_RP_ID_CURRENT_HOST'
		]));
	});

	it('accepts the deployed alpha origin for production passkeys', () => {
		process.env.NODE_ENV = 'production';
		process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
		process.env.BETTER_AUTH_SECRET = 'auth-secret-with-more-than-32-characters';
		process.env.BETTER_AUTH_URL = 'https://todokanban-alpha.vercel.app';
		process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://todokanban-alpha.vercel.app';
		process.env.PASSKEY_ORIGIN = 'https://todokanban-alpha.vercel.app';
		process.env.PASSKEY_RP_ID = 'todokanban-alpha.vercel.app';
		process.env.AUTH_ALLOWED_EMAILS = 'scyea@naver.com,scyea1995@gmail.com';
		process.env.ACCOUNT_RECOVERY_SECRET = 'recovery-secret-with-more-than-32-characters';
		process.env.RESEND_API_KEY = 'resend-api-key-with-more-than-32-characters';
		process.env.EMAIL_FROM = 'Todokanban <onboarding@resend.dev>';
		process.env.CALENDAR_TOKEN_SECRET = 'calendar-token-secret-with-more-than-32-characters';

		const report = getRuntimeConfigReport({ currentOrigin: 'https://todokanban-alpha.vercel.app' });

		expect(report.ok).toBe(true);
		expect(report.blocking).toHaveLength(0);
	});

	it('recognizes placeholder values', () => {
		expect(isPlaceholderValue('replace-with-secret')).toBe(true);
		expect(isPlaceholderValue('please-change-me')).toBe(true);
		expect(isPlaceholderValue('real-secret-with-more-than-32-characters')).toBe(false);
	});
});

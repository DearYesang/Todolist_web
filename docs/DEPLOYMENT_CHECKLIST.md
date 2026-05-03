# Deployment Checklist

Use this checklist before moving the SvelteKit app from the PR branch to production.

## Required Commands

```bash
npm ci
npm run doctor
npm run db:migrate
npm test
npm run check
npm run build
```

`npm run doctor` validates required production secrets and OAuth/email configuration from the current environment.

## Required Environment

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `PASSKEY_ORIGIN`
- `PASSKEY_RP_ID`
- `ACCOUNT_RECOVERY_SECRET`
- `EMAIL_DELIVERY_WEBHOOK_URL`
- `CALENDAR_TOKEN_SECRET`

Calendar provider sync additionally needs:

- `CALENDAR_OAUTH_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_CLIENT_ID`
- `MICROSOFT_CALENDAR_CLIENT_SECRET`

## Health Checks

- `/api/health` returns non-secret readiness details.
- `/api/health?strict=true` returns `503` if required production configuration is missing or unsafe.

## Manual Smoke

- Create a passkey account with an email verification code.
- Generate and store recovery codes.
- Create, edit, delete, and reload a task.
- Export and replace-import a JSON backup.
- Create and revoke an iCalendar subscription token.
- Connect a Google or Microsoft calendar account in a staging OAuth app.
- Run manual calendar sync and confirm event links are created.
- Go offline, edit an existing server task, come back online, and confirm the queued write flushes.

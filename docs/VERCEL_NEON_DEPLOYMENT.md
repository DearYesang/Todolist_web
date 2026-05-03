# Vercel + Neon Deployment Plan

## Decisions

- App domain: `https://todokanban.com`
- Passkey RP ID: `todokanban.com`
- Allowed registration emails: `scyea@naver.com`, `scyea1995@gmail.com`
- Email delivery: Resend
- Primary calendar provider: Google Calendar
- Runtime region: Vercel Tokyo (`hnd1`) close to a Neon Asia region
- DB migrations: manual

`.app` is not required for passkeys. The important requirement is that the final production origin uses HTTPS and the RP ID matches the deployed domain.

## Vercel Environment

Set these in Vercel Production:

```env
DATABASE_URL="postgresql://..."
BETTER_AUTH_SECRET="..."
BETTER_AUTH_URL="https://todokanban.com"
BETTER_AUTH_TRUSTED_ORIGINS="https://todokanban.com"
PASSKEY_ORIGIN="https://todokanban.com"
PASSKEY_RP_ID="todokanban.com"
AUTH_ALLOWED_EMAILS="scyea@naver.com,scyea1995@gmail.com"
ACCOUNT_RECOVERY_SECRET="..."
RESEND_API_KEY="..."
EMAIL_FROM="Todokanban <no-reply@todokanban.com>"
CALENDAR_TOKEN_SECRET="..."
CALENDAR_OAUTH_ENCRYPTION_KEY="..."
GOOGLE_CALENDAR_CLIENT_ID="..."
GOOGLE_CALENDAR_CLIENT_SECRET="..."
CALENDAR_SYNC_MAX_TASKS="250"
```

## Manual Migration

Run migrations locally against the Neon production branch after confirming `DATABASE_URL` points at production:

```bash
npm run db:migrate
```

## Smoke Test

1. Open `https://todokanban.com/api/health?strict=true`.
2. Confirm the board is hidden before login.
3. Request a verification code for `scyea@naver.com`.
4. Confirm an unlisted email is rejected.
5. Register a passkey and generate recovery codes.
6. Add a task, reload, edit, and delete it.
7. Create an iCalendar feed token and subscribe from Apple Calendar.
8. Connect Google Calendar and run manual sync.
9. On an already logged-in device, go offline, reload, edit a task, then reconnect and confirm sync.

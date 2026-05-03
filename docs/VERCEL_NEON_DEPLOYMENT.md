# Vercel + Neon Deployment Plan

## Decisions

- App domain: `https://todokanban.vercel.app`
- Passkey RP ID: `todokanban.vercel.app`
- Allowed registration emails: `scyea@naver.com`, `scyea1995@gmail.com`
- Email delivery: Resend sandbox sender for the first free deployment
- Primary calendar provider: Google Calendar
- Runtime region: Vercel Tokyo (`hnd1`) close to a Neon Asia region
- DB migrations: manual

Because `vercel.app` is a shared public suffix, the passkey RP ID should be the exact project host: `todokanban.vercel.app`.

If the Vercel project name is unavailable and the deployment URL changes, update `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PASSKEY_ORIGIN`, and `PASSKEY_RP_ID` together before registering passkeys.

## Vercel Environment

Set these in Vercel Production:

```env
DATABASE_URL="postgresql://..."
BETTER_AUTH_SECRET="..."
BETTER_AUTH_URL="https://todokanban.vercel.app"
BETTER_AUTH_TRUSTED_ORIGINS="https://todokanban.vercel.app"
PASSKEY_ORIGIN="https://todokanban.vercel.app"
PASSKEY_RP_ID="todokanban.vercel.app"
AUTH_ALLOWED_EMAILS="scyea@naver.com,scyea1995@gmail.com"
ACCOUNT_RECOVERY_SECRET="..."
RESEND_API_KEY="..."
EMAIL_FROM="Todokanban <onboarding@resend.dev>"
CALENDAR_TOKEN_SECRET="..."
CALENDAR_OAUTH_ENCRYPTION_KEY="..."
GOOGLE_CALENDAR_CLIENT_ID="..."
GOOGLE_CALENDAR_CLIENT_SECRET="..."
CALENDAR_SYNC_MAX_TASKS="250"
```

`onboarding@resend.dev` is Resend's testing sender and can only deliver to the email address associated with the Resend account. For both allowed emails to receive codes independently, verify a custom email domain later and switch `EMAIL_FROM` to that domain.

## Manual Migration

Run migrations locally against the Neon production branch after confirming `DATABASE_URL` points at production:

```bash
npm run db:migrate
```

## Smoke Test

1. Open `https://todokanban.vercel.app/api/health?strict=true`.
2. Confirm the board is hidden before login.
3. Request a verification code for `scyea@naver.com`.
4. Confirm an unlisted email is rejected.
5. Register a passkey and generate recovery codes.
6. Add a task, reload, edit, and delete it.
7. Create an iCalendar feed token and subscribe from Apple Calendar.
8. Connect Google Calendar and run manual sync.
9. On an already logged-in device, go offline, reload, edit a task, then reconnect and confirm sync.

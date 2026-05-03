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

Generate secret values locally:

```bash
npm run secrets
```

The command prints values for:

- `BETTER_AUTH_SECRET`
- `ACCOUNT_RECOVERY_SECRET`
- `CALENDAR_TOKEN_SECRET`
- `CALENDAR_OAUTH_ENCRYPTION_KEY`
- `EMAIL_DELIVERY_WEBHOOK_SECRET` if webhook delivery is used later

Do not save these generated values in git. Paste only the required values into Vercel Production environment variables.

## Free Deployment Runbook

1. Merge the PR into `main`.
2. Create a Neon project in an Asia region and copy the pooled Postgres URL.
3. Create a Vercel project from this GitHub repository with project name `todokanban`.
4. Confirm the deployment URL is exactly `https://todokanban.vercel.app`.
5. Generate deployment secrets with `npm run secrets`.
6. Add the Vercel Production environment variables listed above.
7. Create or open a Resend account using one of the allowed emails.
8. Set `RESEND_API_KEY` from Resend and keep `EMAIL_FROM=Todokanban <onboarding@resend.dev>` for the first free deployment.
9. Locally set `DATABASE_URL` to the Neon production URL and run `npm run db:migrate`.
10. Trigger a Vercel production deploy from `main`.
11. Run the smoke test below.

If Vercel cannot allocate the `todokanban` project name, stop before registering passkeys and update the four passkey origin values to the actual `*.vercel.app` host.

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

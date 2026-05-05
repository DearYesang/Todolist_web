# Vercel + Neon Deployment Plan

## Decisions

- App domain: `https://todokanban-alpha.vercel.app`
- Passkey RP ID: `todokanban-alpha.vercel.app`
- Allowed registration emails: `scyea@naver.com`, `scyea1995@gmail.com`
- Email delivery: Resend sandbox sender for the first free deployment
- Primary calendar feed: iCal subscription links
- First external calendar provider: Google Calendar
- Runtime region: Vercel Tokyo (`hnd1`) close to a Neon Asia region
- DB migrations: manual

Because `vercel.app` is a shared public suffix, the passkey RP ID should be the exact project host: `todokanban-alpha.vercel.app`.

If the Vercel project name is unavailable and the deployment URL changes, update `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PASSKEY_ORIGIN`, and `PASSKEY_RP_ID` together before registering passkeys.

## Vercel Environment

Set these in Vercel Production:

```env
DATABASE_URL="postgresql://..."
BETTER_AUTH_SECRET="..."
BETTER_AUTH_URL="https://todokanban-alpha.vercel.app"
BETTER_AUTH_TRUSTED_ORIGINS="https://todokanban-alpha.vercel.app"
PASSKEY_ORIGIN="https://todokanban-alpha.vercel.app"
PASSKEY_RP_ID="todokanban-alpha.vercel.app"
AUTH_ALLOWED_EMAILS="scyea@naver.com,scyea1995@gmail.com"
ACCOUNT_RECOVERY_SECRET="..."
RESEND_API_KEY="..."
EMAIL_FROM="Todokanban <onboarding@resend.dev>"
CALENDAR_TOKEN_SECRET="..."
CALENDAR_OAUTH_ENCRYPTION_KEY="..."
GOOGLE_CALENDAR_CLIENT_ID="..."
GOOGLE_CALENDAR_CLIENT_SECRET="..."
CALENDAR_SYNC_MAX_TASKS="250"
CALENDAR_BACKGROUND_SYNC_MAX_USERS="10"
CRON_SECRET="..."
```

For Google Calendar, create a Google Cloud OAuth client as a Web application and register:

```text
https://todokanban-alpha.vercel.app/api/calendar/providers/google/callback
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
- `CRON_SECRET`
- `EMAIL_DELIVERY_WEBHOOK_SECRET` if webhook delivery is used later

Do not save these generated values in git. Paste only the required values into Vercel Production environment variables.

## Free Deployment Runbook

1. Merge the PR into `main`.
2. Create a Neon project in an Asia region and copy the pooled Postgres URL.
3. Create a Vercel project from this GitHub repository with project name `todokanban-alpha`.
4. Confirm the deployment URL is exactly `https://todokanban-alpha.vercel.app`.
5. Generate deployment secrets with `npm run secrets`.
6. Add the Vercel Production environment variables listed above.
7. Create or open a Resend account using one of the allowed emails.
8. Set `RESEND_API_KEY` from Resend and keep `EMAIL_FROM=Todokanban <onboarding@resend.dev>` for the first free deployment.
9. Locally set `DATABASE_URL` to the Neon production URL and run `npm run db:migrate`.
10. Trigger a Vercel production deploy from `main`.
11. Run the smoke test below.
12. Confirm Vercel registered the daily calendar cron job under **Settings -> Cron Jobs**.

If Vercel cannot allocate the `todokanban-alpha` project name, stop before registering passkeys and update the four passkey origin values to the actual `*.vercel.app` host.

## Manual Migration

Run migrations locally against the Neon production branch after confirming `DATABASE_URL` points at production:

```bash
npm run db:migrate
```

## Smoke Test

1. Open `https://todokanban-alpha.vercel.app/api/health?strict=true`.
2. Open `https://todokanban-alpha.vercel.app/api/auth/passkey/generate-authenticate-options` and confirm it is handled by the auth route rather than a SvelteKit `404` page.
3. Confirm the board is hidden before login.
4. Request a verification code for `scyea@naver.com`.
5. Confirm an unlisted email is rejected.
6. Register a passkey and generate recovery codes.
7. Add a task, reload, edit, and delete it.
8. Create an iCal link and subscribe from Apple Calendar.
9. Download a single task `.ics` file from a task card or task detail panel.
10. Connect Google Calendar and run manual external calendar sync.
11. Mark a previously synced task done, run external calendar sync again, and confirm the provider event is deleted.
12. On an already logged-in device, go offline, reload, edit a task, then reconnect and confirm sync.
13. Trigger the secured calendar cron manually with `Authorization: Bearer $CRON_SECRET`, or wait for the daily Vercel Cron run and confirm runtime logs show `/api/calendar/sync/cron`.

## Calendar Cron

The repository includes `vercel.json` with one daily Hobby-compatible cron:

```txt
0 21 * * *
```

That runs at 21:00 UTC, which is 06:00 in Korea Standard Time. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when the Production environment has a `CRON_SECRET` variable. Keep the UI sync button as the immediate manual path; the cron is only a daily safety net for connected provider calendars.

## Vercel Dashboard Quick Guide

Use the stable app URL as the source of truth: `https://todokanban-alpha.vercel.app`.

The generated deployment URLs under **Deployments** can show `401`, `403`, or a forbidden thumbnail when Vercel protection is applied. That does not mean the production app is down. Use those URLs only for inspecting a specific build.

For day-to-day checks:

1. Open the stable app URL.
2. Open `https://todokanban-alpha.vercel.app/api/health?strict=true`.
3. In Vercel, use **Logs** for runtime errors and **Environment Variables** for secret changes.
4. Ignore the deployment preview image if the stable app URL and strict health check are healthy.

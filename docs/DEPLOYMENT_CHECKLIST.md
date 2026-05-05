# Deployment Checklist

Use this checklist before moving the SvelteKit app from the PR branch to Vercel production.

## Required Commands

```bash
npm ci
npm run secrets
npm run doctor
npm run db:migrate
npm audit --audit-level=low
npm test
npm run check
npm run build
```

`npm run doctor` validates required production secrets and OAuth/email configuration from the current environment.
`npm run secrets` prints fresh secret values for Vercel; do not commit its output.

## Required Environment

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `PASSKEY_ORIGIN`
- `PASSKEY_RP_ID`
- `AUTH_ALLOWED_EMAILS`
- `ACCOUNT_RECOVERY_SECRET`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `CALENDAR_TOKEN_SECRET`

Production values for the personal deployment:

- `BETTER_AUTH_URL=https://todokanban-alpha.vercel.app`
- `BETTER_AUTH_TRUSTED_ORIGINS=https://todokanban-alpha.vercel.app`
- `PASSKEY_ORIGIN=https://todokanban-alpha.vercel.app`
- `PASSKEY_RP_ID=todokanban-alpha.vercel.app`
- `AUTH_ALLOWED_EMAILS=scyea@naver.com,scyea1995@gmail.com`
- `EMAIL_FROM=Todokanban <onboarding@resend.dev>`

`onboarding@resend.dev` only delivers to the email address associated with the Resend account. Use that email for the first passkey registration, or verify a custom domain later.

Webhook email delivery remains available with `EMAIL_DELIVERY_WEBHOOK_URL` and `EMAIL_DELIVERY_WEBHOOK_SECRET` if Resend is not used.

Google/Microsoft provider sync is currently hidden from the primary UI because the personal workflow is `.ics`-first. If provider sync is re-enabled later, it additionally needs:

- `CALENDAR_OAUTH_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `CRON_SECRET` for the optional daily Vercel Cron sync endpoint
- `CALENDAR_BACKGROUND_SYNC_MAX_USERS` if the default `10` connected users per cron run should change

Create the Google OAuth client as a Web application and add this authorized redirect URI:

```text
https://todokanban-alpha.vercel.app/api/calendar/providers/google/callback
```

For the first smoke test, the Google OAuth app can stay in **Testing**, but the Google account used to connect Calendar must be added under **Google Auth Platform -> Audience -> Test users**. For this personal deployment, add `scyea1995@gmail.com` first. A non-Gmail address only works here if it is also a Google Account.

Testing authorizations expire after 7 days. After the sync/delete smoke passes, move the app to **In production** if you want the personal Google Calendar connection to remain usable without weekly re-authorization. A personal app under 100 users can be used without completing full OAuth verification, but Google may show an unverified-app warning for sensitive scopes.

Microsoft Calendar is optional for later:

- `MICROSOFT_CALENDAR_CLIENT_ID`
- `MICROSOFT_CALENDAR_CLIENT_SECRET`

## Health Checks

- `/api/health` returns non-secret readiness details.
- `/api/health?strict=true` returns `503` if required production configuration is missing or unsafe.
- `/api/auth/passkey/generate-authenticate-options` should not return a SvelteKit `404` page. A handled auth/config JSON response is fine; a page 404 means the Better Auth route is not mounted for the deployed host.

## Manual Smoke

- Confirm `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PASSKEY_ORIGIN`, and `PASSKEY_RP_ID` exactly match the deployed host before registering passkeys.
- Create a passkey account with an email verification code.
- Generate and store recovery codes.
- Create, edit, delete, and reload a task.
- Export and replace-import a JSON backup.
- Create and revoke a whole-board `.ics` sync link from `전체 일정 동기화`.
- Download a single task `.ics` file from a card or task detail panel.
- If provider sync is re-enabled, connect a Google or Microsoft calendar account in a staging OAuth app. If Google returns `403 access_denied`, confirm the signed-in Google account is in the OAuth app's Test users list.
- If provider sync is re-enabled, run manual external calendar sync and confirm event links are created.
- If provider sync is re-enabled, mark a synced task done, run manual external calendar sync again, and confirm the provider event is deleted.
- If provider sync is re-enabled, confirm Vercel registered `/api/calendar/sync/cron` under Cron Jobs after deploy.
- Confirm a logged-out browser cannot see the board.
- Confirm an unauthorized email cannot request a verification code.
- Go offline, edit an existing server task, come back online, and confirm the queued write flushes.
- If a version conflict is forced, confirm the conflict panel can apply a task update/delete locally, keep the server version, and export a JSON report.
- On an already logged-in device, go offline, reload, and confirm the local board still opens.
